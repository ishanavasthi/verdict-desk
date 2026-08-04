import {
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
}

/**
 * Derive the feedback generation state from the submission status and the
 * (optional) persisted feedback row. Mirrors grading.service.ts, which only
 * fires feedback generation for PASSED/FAILED submissions — an ERRORed
 * submission never gets a row, so it is SKIPPED rather than perpetually PENDING.
 */
export function computeFeedbackStatus(
  submissionStatus: string,
  feedback: { validationStatus: string } | null,
): FeedbackGenerationStatus {
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
    return this.prisma.submission.findMany({
      where: {
        userId: user.id,
        ...(query.problemId ? { problemId: query.problemId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, problemId: true, status: true, score: true, createdAt: true },
    });
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
      feedbackStatus: computeFeedbackStatus(submission.status, submission.aiFeedback),
      feedback: submission.aiFeedback
        ? {
            status: submission.aiFeedback.validationStatus as 'VALID' | 'FLAGGED',
            model: submission.aiFeedback.model,
            unreviewed: true,
            content: submission.aiFeedback.content,
          }
        : null,
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

    if (computeFeedbackStatus(submission.status, submission.aiFeedback) !== 'FAILED') {
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
