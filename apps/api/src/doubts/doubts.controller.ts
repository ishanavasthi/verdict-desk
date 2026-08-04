import { Body, Controller, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';
import { CreateDoubtDto } from './dto/create-doubt.dto';
import { AiDraftPipeline } from './ai-draft.pipeline';
import { visibleAnswerWhere } from './answer-visibility';

export interface AnswerView {
  id: string;
  authorType: string;
  state: string;
  content: string;
  editedContent: string | null;
  reviewedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoubtView {
  id: string;
  problemId: string | null;
  authorId: string;
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
  async create(@Body() dto: CreateDoubtDto, @CurrentUser() user: RequestUser): Promise<CreateDoubtResponse> {
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
    return this.prisma.doubt.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        answers: {
          where: visibleAnswerWhere(user),
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<DoubtView> {
    const doubt = await this.prisma.doubt.findUnique({
      where: { id },
      include: {
        answers: {
          where: visibleAnswerWhere(user),
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!doubt) {
      throw new NotFoundException(`doubt ${id} not found`);
    }
    return doubt;
  }
}
