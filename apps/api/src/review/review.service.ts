import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AnswerState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isTriggerGuardError } from '../doubts/db-conflict';
import { sanitizeContent } from '../doubts/sanitize';

export interface ReviewQueueItem {
  id: string;
  doubtId: string;
  authorType: string;
  state: string;
  content: string;
  editedContent: string | null;
  createdAt: Date;
  updatedAt: Date;
  doubt: {
    id: string;
    title: string;
    body: string;
    authorId: string;
  };
}

interface CasTransitionArgs {
  answerId: string;
  fromState: AnswerState;
  toState: AnswerState;
  action: 'approve' | 'reject' | 'edit';
  actorId: string;
  extraData: Record<string, unknown>;
}

/**
 * Teacher-review actions against the `answers` table, ALL implemented as a
 * guarded compare-and-swap (`updateMany({ where: { id, state: fromState } })`)
 * so a stale/concurrent request can never silently clobber a decision another
 * teacher (or the AI pipeline) already made. Both ways this can fail are
 * mapped to HTTP 409 (never 500):
 *   1. affected-count 0 — the row already moved out of `fromState`.
 *   2. the DB trigger itself rejects the write (defense in depth — should be
 *      unreachable given the CAS predicate, but caught regardless).
 * Every successful transition writes a ReviewAudit row in the same call.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** All PENDING_REVIEW answers joined to their doubts, newest first — data for the review UI. */
  async queue(): Promise<ReviewQueueItem[]> {
    return this.prisma.answer.findMany({
      where: { state: AnswerState.PENDING_REVIEW },
      orderBy: { createdAt: 'desc' },
      include: {
        doubt: { select: { id: true, title: true, body: true, authorId: true } },
      },
    });
  }

  async approve(answerId: string, teacherId: string, editedContent?: string): Promise<void> {
    const extraData: Record<string, unknown> = { reviewedById: teacherId };
    if (editedContent !== undefined) {
      extraData.editedContent = sanitizeContent(editedContent);
    }
    await this.casTransition({
      answerId,
      fromState: AnswerState.PENDING_REVIEW,
      toState: AnswerState.APPROVED,
      action: 'approve',
      actorId: teacherId,
      extraData,
    });
  }

  async reject(answerId: string, teacherId: string, reason?: string): Promise<void> {
    // `reason` has no dedicated column on Answer or ReviewAudit in the fixed
    // M0 schema (which M4 was told not to alter) — accept + sanitize it for
    // input hygiene and log it server-side rather than silently drop it.
    if (reason !== undefined) {
      this.logger.log(`answer ${answerId} rejected by ${teacherId}; reason: ${sanitizeContent(reason, 1000)}`);
    }
    await this.casTransition({
      answerId,
      fromState: AnswerState.PENDING_REVIEW,
      toState: AnswerState.REJECTED,
      action: 'reject',
      actorId: teacherId,
      extraData: { reviewedById: teacherId },
    });
  }

  /** Same-state PENDING_REVIEW -> PENDING_REVIEW: a content edit mid-review, always legal per the trigger. */
  async edit(answerId: string, teacherId: string, editedContent: string): Promise<void> {
    await this.casTransition({
      answerId,
      fromState: AnswerState.PENDING_REVIEW,
      toState: AnswerState.PENDING_REVIEW,
      action: 'edit',
      actorId: teacherId,
      extraData: { editedContent: sanitizeContent(editedContent), reviewedById: teacherId },
    });
  }

  private async casTransition(args: CasTransitionArgs): Promise<void> {
    const { answerId, fromState, toState, action, actorId, extraData } = args;

    let updated: { count: number };
    try {
      updated = await this.prisma.answer.updateMany({
        where: { id: answerId, state: fromState },
        data: { state: toState, ...extraData },
      });
    } catch (err) {
      if (isTriggerGuardError(err)) {
        this.logger.warn(
          `DB trigger rejected ${action} on answer ${answerId}: ${(err as Error).message}`,
        );
        throw new ConflictException(
          `answer ${answerId} cannot be ${action}d: the database rejected this state transition`,
        );
      }
      throw err;
    }

    if (updated.count === 0) {
      throw new ConflictException(
        `answer ${answerId} is not in state ${fromState} (already moved, or does not exist) — cannot ${action}`,
      );
    }

    await this.prisma.reviewAudit.create({
      data: { answerId, action, fromState, toState, actorId },
    });
  }
}
