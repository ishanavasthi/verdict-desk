import {
  BadRequestException,
  ConflictException,
  Controller,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequestUser } from '../auth/types';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { DEFAULT_SUBMISSIONS_PER_MIN, RATE_LIMIT_SUBMISSIONS_ENV, RATE_LIMIT_WINDOW_MS, envLimit } from '../common/rate-limit.config';
import { AiFeedbackService } from '../ai/feedback.service';
import { SubmissionQueueService } from './submission-queue.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { ListSubmissionsQueryDto } from './dto/list-submissions.dto';
import { RawTestResultRow, RedactedTestResultView, redactResults } from './redact-results';
import { McqOption, gradeObjective, validateObjectiveAnswer } from './objective-grading';

export interface CreateSubmissionResponse {
  id: string;
  status: string;
}

/**
 * `unreviewed` is always `true`: the code-feedback path has NO human review
 * gate (unlike the M4 doubt-answer path) — it is AI output shown as-is,
 * flagged only as VALID (schema-conformant) or FLAGGED (failed validation
 * twice; `content` is then a safe fallback, never unvalidated free text).
 */
export interface SubmissionFeedbackView {
  status: 'VALID' | 'FLAGGED';
  model: string;
  unreviewed: true;
  content: unknown;
}

/**
 * Coarse generation state for the AI feedback, so the client can poll
 * intelligently instead of guessing from `feedback === null`:
 *  - `PENDING`  — feedback is expected but hasn't landed yet (grading still
 *                 running, or the async fire-and-forget job hasn't finished).
 *                 The live model can take ~1–2 min, so the client keeps polling.
 *  - `READY`    — validated feedback is available (`feedback.content` present).
 *  - `FAILED`   — generation ran but the output failed validation twice
 *                 (`feedback.status === 'FLAGGED'`); a safe fallback is shown.
 *  - `SKIPPED`  — no feedback will ever be produced (submission ERRORed, so
 *                 there's no meaningful code output to critique).
 */
export type FeedbackGenerationStatus = 'PENDING' | 'READY' | 'FAILED' | 'SKIPPED';

export interface SubmissionView {
  id: string;
  problemId: string;
  status: string;
  score: number | null;
  results: RedactedTestResultView[];
  feedbackStatus: FeedbackGenerationStatus;
  feedback: SubmissionFeedbackView | null;
  problemKind: string;
  submittedAnswer: string | null;
}

/**
 * Derive the feedback generation state from the submission status, problem
 * kind, and the (optional) persisted feedback row. Mirrors grading.service.ts,
 * which only fires feedback generation for PASSED/FAILED CODE submissions —
 * an ERRORed submission never gets a row (SKIPPED rather than perpetually
 * PENDING), and non-CODE kinds never get one either (they never touch the AI
 * feedback pipeline at all).
 */
export function computeFeedbackStatus(
  submissionStatus: string,
  feedback: { validationStatus: string } | null,
  problemKind: string,
): FeedbackGenerationStatus {
  if (problemKind !== 'CODE') {
    return 'SKIPPED';
  }
  if (feedback) {
    return feedback.validationStatus === 'VALID' ? 'READY' : 'FAILED';
  }
  if (submissionStatus === 'ERROR') {
    return 'SKIPPED';
  }
  return 'PENDING';
}

export interface SubmissionHistoryItem {
  id: string;
  problemId: string;
  status: string;
  score: number | null;
  createdAt: Date;
  problemKind: string;
}

@Controller('submissions')
@UseGuards(JwtAuthGuard)
export class SubmissionsController {
  private readonly logger = new Logger(SubmissionsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SubmissionQueueService,
    private readonly aiFeedback: AiFeedbackService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @Throttle({
    default: { limit: envLimit(RATE_LIMIT_SUBMISSIONS_ENV, DEFAULT_SUBMISSIONS_PER_MIN), ttl: RATE_LIMIT_WINDOW_MS },
  })
  async create(
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateSubmissionResponse> {
    // Load the problem's kind first: CODE keeps today's sandbox/queue path
    // exactly as-is; MCQ/INTEGER are graded instantly, in-process, with no
    // queue, no sandbox, no LLM. A nonexistent problemId falls through to
    // the CODE path below and fails at submission.create() (FK violation),
    // same as before this change.
    const problem = await this.prisma.problem.findUnique({
      where: { id: dto.problemId },
      select: { kind: true, options: true, answerKey: true },
    });

    if (problem && problem.kind !== 'CODE') {
      const kind = problem.kind as 'MCQ' | 'INTEGER';
      const options = kind === 'MCQ' ? ((problem.options as unknown as McqOption[]) ?? []) : null;
      const validation = validateObjectiveAnswer(kind, dto.code, options);
      if (!validation.ok) {
        // Generic message — never reveals the correct answer or valid option ids.
        throw new BadRequestException('invalid answer for this question');
      }

      const { status, score } = gradeObjective(kind, validation.normalized, problem.answerKey ?? '');

      const submission = await this.prisma.submission.create({
        data: {
          problemId: dto.problemId,
          userId: user.id,
          code: dto.code,
          language: dto.language ?? 'JS',
          status,
          score,
        },
      });

      return { id: submission.id, status: submission.status };
    }

    // Backpressure: reject (503) when the grading backlog is full, BEFORE
    // creating a row — so we never leave an ungradeable QUEUED submission.
    if (!this.queue.canAccept()) {
      throw new ServiceUnavailableException('grading queue is full — retry shortly');
    }

    const submission = await this.prisma.submission.create({
      data: {
        problemId: dto.problemId,
        userId: user.id,
        code: dto.code,
        language: dto.language ?? 'JS',
        status: 'QUEUED',
      },
    });

    this.queue.enqueue(submission.id);

    return { id: submission.id, status: submission.status };
  }

  /** The authenticated user's own submission history, newest first, optionally scoped to one problem. */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListSubmissionsQueryDto,
  ): Promise<SubmissionHistoryItem[]> {
    const submissions = await this.prisma.submission.findMany({
      where: {
        userId: user.id,
        ...(query.problemId ? { problemId: query.problemId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        problemId: true,
        status: true,
        score: true,
        createdAt: true,
        problem: { select: { kind: true } },
      },
    });

    return submissions.map(({ problem, ...rest }) => ({ ...rest, problemKind: problem.kind }));
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<SubmissionView> {
    // Authorization enforced IN the query: a STUDENT can only ever match their
    // own rows; a TEACHER can match any. A submission that exists but belongs
    // to someone else therefore comes back `null` here — same as truly not
    // existing — so we never leak whether it exists to a non-owner.
    const submission = await this.prisma.submission.findFirst({
      where: {
        id,
        ...(user.role === 'TEACHER' ? {} : { userId: user.id }),
      },
      include: {
        testResults: { include: { testCase: { select: { hidden: true } } } },
        aiFeedback: true,
        problem: { select: { kind: true } },
      },
    });
    if (!submission) {
      throw new NotFoundException(`submission ${id} not found`);
    }

    const rawResults: RawTestResultRow[] = submission.testResults.map((r) => ({
      testCaseId: r.testCaseId,
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      timeMs: r.timeMs,
    }));
    const hiddenByTestCaseId = new Map(submission.testResults.map((r) => [r.testCaseId, r.testCase.hidden]));

    return {
      id: submission.id,
      problemId: submission.problemId,
      status: submission.status,
      score: submission.score,
      results: redactResults(rawResults, hiddenByTestCaseId),
      feedbackStatus: computeFeedbackStatus(submission.status, submission.aiFeedback, submission.problem.kind),
      feedback: submission.aiFeedback
        ? {
            status: submission.aiFeedback.validationStatus as 'VALID' | 'FLAGGED',
            model: submission.aiFeedback.model,
            unreviewed: true,
            content: submission.aiFeedback.content,
          }
        : null,
      problemKind: submission.problem.kind,
      submittedAnswer: submission.problem.kind !== 'CODE' ? submission.code : null,
    };
  }

  @Post(':id/feedback/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RateLimitGuard)
  @Throttle({
    default: { limit: envLimit(RATE_LIMIT_SUBMISSIONS_ENV, DEFAULT_SUBMISSIONS_PER_MIN), ttl: RATE_LIMIT_WINDOW_MS },
  })
  async regenerateFeedback(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ id: string; feedbackStatus: 'PENDING' }> {
    // Same ownership rule as get(): existence is never leaked to a non-owner.
    const submission = await this.prisma.submission.findFirst({
      where: {
        id,
        ...(user.role === 'TEACHER' ? {} : { userId: user.id }),
      },
      include: { aiFeedback: true },
    });
    if (!submission) {
      throw new NotFoundException(`submission ${id} not found`);
    }

    // Feedback regeneration is only ever relevant for CODE submissions (only
    // CODE gets an aiFeedback row in the first place); 'CODE' is passed
    // explicitly since this query doesn't need the problem's kind otherwise.
    if (computeFeedbackStatus(submission.status, submission.aiFeedback, 'CODE') !== 'FAILED') {
      throw new ConflictException('feedback can only be regenerated when generation has failed');
    }

    await this.prisma.aiFeedback.delete({ where: { submissionId: id } });

    // Fire-and-forget, same pattern as grading.service.ts's triggerFeedback:
    // never let feedback generation block or fail this request.
    this.aiFeedback.generateForSubmission(id).catch((err) => {
      this.logger.error(
        `AI feedback regeneration failed for submission ${id}: ${(err as Error).message}`,
      );
    });

    return { id: submission.id, feedbackStatus: 'PENDING' };
  }
}
