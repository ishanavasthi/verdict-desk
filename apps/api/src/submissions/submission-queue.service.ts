import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../sandbox/grading.service';

const DEFAULT_CONCURRENCY = 2;

/**
 * Seam other backends (e.g. BullMQ) can implement instead of
 * `SubmissionQueueService` without touching any caller — callers only ever
 * depend on `enqueue(submissionId)`.
 */
export interface SubmissionQueue {
  enqueue(submissionId: string): void;
}

/**
 * In-process, concurrency-limited worker pool implementing `SubmissionQueue`.
 * Intentionally simple (no external deps): a promise pool draining a FIFO
 * array. Good enough for M1's single-process API; swap for BullMQ (or any
 * other backend) later behind the same `enqueue` seam if grading needs to
 * scale beyond one process.
 */
@Injectable()
export class SubmissionQueueService implements SubmissionQueue, OnModuleInit {
  private readonly logger = new Logger(SubmissionQueueService.name);
  private readonly concurrency: number;
  private readonly pending: string[] = [];
  private active = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    private readonly config: ConfigService,
  ) {
    const configured = Number(this.config.get<string>('GRADING_CONCURRENCY'));
    this.concurrency =
      Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_CONCURRENCY;
  }

  /**
   * Sweep on startup: any submission left QUEUED/RUNNING means the process
   * restarted mid-grade — those runs were interrupted, not merely slow, so
   * they can never legitimately resolve. Mark them ERROR rather than leaving
   * them stuck forever.
   */
  async onModuleInit(): Promise<void> {
    const swept = await this.prisma.submission.updateMany({
      where: { status: { in: [SubmissionStatus.QUEUED, SubmissionStatus.RUNNING] } },
      data: { status: SubmissionStatus.ERROR },
    });
    if (swept.count > 0) {
      this.logger.warn(`startup sweep: marked ${swept.count} interrupted submission(s) ERROR`);
    }
  }

  enqueue(submissionId: string): void {
    this.pending.push(submissionId);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const id = this.pending.shift();
      if (id === undefined) return;
      this.active += 1;
      this.grading
        .grade(id)
        .catch((err) => {
          this.logger.error(`grading failed for submission ${id}: ${(err as Error).message}`);
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}
