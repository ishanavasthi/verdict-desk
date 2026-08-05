import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { DEFAULT_DOUBTS_PER_MIN, RATE_LIMIT_DOUBTS_ENV, RATE_LIMIT_WINDOW_MS, envLimit } from '../common/rate-limit.config';
import { CreateDoubtDto } from './dto/create-doubt.dto';
import { AiDraftPipeline } from './ai-draft.pipeline';
import { readableAnswerContent, visibleAnswerWhere } from './answer-visibility';

export interface AnswerView {
  id: string;
  authorType: string;
  state: string;
  /**
   * The answer's effective text — or `null` when the viewer isn't entitled to
   * read it yet (any non-APPROVED answer, for any non-TEACHER viewer). The
   * doubt's author still receives the row so the UI can show that a draft
   * exists and where it is in review; it just never carries the words.
   */
  content: string | null;
  editedContent: string | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoubtView {
  id: string;
  problemId: string | null;
  authorId: string;
  author: { email: string; name: string | null } | null;
  title: string;
  body: string;
  createdAt: Date;
  answers: AnswerView[];
}

export interface CreateDoubtResponse {
  id: string;
}

/**
 * Doubt board: any authed user (student or teacher) may post a doubt and see
 * the board. Per-answer visibility (which answers show up under each doubt)
 * is enforced IN the query via `visibleAnswerWhere` — see answer-visibility.ts.
 */
@Controller('doubts')
@UseGuards(JwtAuthGuard)
export class DoubtsController {
  private readonly logger = new Logger(DoubtsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiDraft: AiDraftPipeline,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @Throttle({
    default: { limit: envLimit(RATE_LIMIT_DOUBTS_ENV, DEFAULT_DOUBTS_PER_MIN), ttl: RATE_LIMIT_WINDOW_MS },
  })
  async create(@Body() dto: CreateDoubtDto, @CurrentUser() user: RequestUser): Promise<CreateDoubtResponse> {
    // A doubt may be unattached (problemId omitted), but if one IS given it
    // must exist — otherwise doubt.create() dies on the FK constraint and the
    // client sees a 500 for what is plainly a bad request.
    if (dto.problemId) {
      const problem = await this.prisma.problem.findUnique({
        where: { id: dto.problemId },
        select: { id: true },
      });
      if (!problem) {
        throw new BadRequestException(`problem ${dto.problemId} not found`);
      }
    }

    const doubt = await this.prisma.doubt.create({
      data: {
        problemId: dto.problemId ?? null,
        authorId: user.id,
        title: dto.title,
        body: dto.body,
      },
    });

    // Fire-and-forget AI draft pipeline: own try/catch inside AiDraftPipeline.run()
    // (never throws), plus a defensive catch here too — this must NEVER fail,
    // delay, or affect the response to this request.
    this.aiDraft.run({ doubtId: doubt.id, title: dto.title, body: dto.body }).catch((err) => {
      this.logger.error(`AI draft pipeline failed for doubt ${doubt.id}: ${(err as Error).message}`);
    });

    return { id: doubt.id };
  }

  /** The board: every doubt, newest first, each with only the viewer's visible answers. */
  @Get()
  async board(@CurrentUser() user: RequestUser): Promise<DoubtView[]> {
    const doubts = await this.prisma.doubt.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { email: true, name: true } },
        answers: {
          where: visibleAnswerWhere(user),
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return doubts.map((d) => this.toDoubtView(d, user));
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DoubtView> {
    const doubt = await this.prisma.doubt.findUnique({
      where: { id },
      include: {
        author: { select: { email: true, name: true } },
        answers: {
          where: visibleAnswerWhere(user),
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!doubt) {
      throw new NotFoundException(`doubt ${id} not found`);
    }
    return this.toDoubtView(doubt, user);
  }

  /**
   * Serialize a doubt for the board/detail, collapsing each answer to its
   * EFFECTIVE text only. When a teacher approves-with-edits, `editedContent` is
   * the vetted version and the raw `content` is the pre-edit AI draft the
   * teacher deliberately replaced — students must NEVER receive that original
   * (otherwise the edit is cosmetic and redaction leaks via the JSON response).
   * So we return `content = editedContent ?? content` and drop the raw column.
   * The teacher's `/review/queue` endpoint (separate) still exposes both for editing.
   *
   * AND, for any viewer who is not a TEACHER, the text of a non-APPROVED answer
   * is withheld entirely (`content: null`). `visibleAnswerWhere` deliberately
   * returns the author their own doubt's answers in EVERY state so they can see
   * that a draft exists and how review went — but "the asker may know an answer
   * is pending" is not "the asker may read unreviewed AI output". Three states
   * are covered by this, all of which used to ship their full text to the asker:
   *   - PENDING_REVIEW — the draft a teacher hasn't ruled on yet.
   *   - REJECTED       — text a teacher explicitly refused to publish.
   *   - DRAFT          — never queued for review at all; for a validation
   *                      failure its `content` is an internal diagnostic string
   *                      (see AiDraftPipeline.persistFailure), not an answer.
   * The UI masks these too, but that mask is cosmetic: it can't stop anyone
   * reading the JSON. This is where the guarantee actually lives.
   */
  private toDoubtView(doubt: {
    id: string;
    problemId: string | null;
    authorId: string;
    author: { email: string; name: string | null } | null;
    title: string;
    body: string;
    createdAt: Date;
    answers: {
      id: string;
      authorType: string;
      state: string;
      content: string;
      editedContent: string | null;
      reviewNote: string | null;
      reviewedById: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[];
  }, viewer: RequestUser): DoubtView {
    return {
      id: doubt.id,
      problemId: doubt.problemId,
      authorId: doubt.authorId,
      author: doubt.author,
      title: doubt.title,
      body: doubt.body,
      createdAt: doubt.createdAt,
      answers: doubt.answers.map((a) => ({
        id: a.id,
        authorType: a.authorType,
        state: a.state,
        content: readableAnswerContent(viewer, a),
        editedContent: null,
        reviewNote: a.reviewNote,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    };
  }
}
