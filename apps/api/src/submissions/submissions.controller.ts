import {
  Controller,
  Body,
  Get,
  HttpCode,
  HttpStatus,
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

export interface SubmissionView {
  id: string;
  problemId: string;
  status: string;
  score: number | null;
  results: RedactedTestResultView[];
  feedback: SubmissionFeedbackView | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: SubmissionQueueService,
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
}
