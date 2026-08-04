/**
 * ReviewService's CAS (compare-and-swap) writes + the 409-mapping for both
 * failure modes: affected-count-0 (already-moved) and a DB trigger
 * rejection (defense in depth). No real database — a fake in-memory Prisma
 * double stands in, so this is a fast, deterministic unit test of the
 * control flow, not an integration test of the actual triggers (those are
 * exercised manually via psql in the milestone's verification steps).
 */
import { ConflictException } from '@nestjs/common';
import { ReviewService } from '../src/review/review.service';

function fakePrisma(overrides?: {
  updateMany?: jest.Mock;
  auditCreate?: jest.Mock;
}) {
  return {
    answer: {
      updateMany: overrides?.updateMany ?? jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
    },
    reviewAudit: {
      create: overrides?.auditCreate ?? jest.fn(async ({ data }: { data: unknown }) => ({ id: 'audit-1', ...(data as object) })),
    },
  };
}

describe('ReviewService — guarded CAS + 409 mapping', () => {
  it('approve(): CAS success sets state/reviewedById (+editedContent if given) and writes an approve audit row', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);

    await service.approve('answer-1', 'teacher-1', 'edited text');

    expect(prisma.answer.updateMany).toHaveBeenCalledWith({
      where: { id: 'answer-1', state: 'PENDING_REVIEW' },
      data: { state: 'APPROVED', reviewedById: 'teacher-1', editedContent: 'edited text' },
    });
    expect(prisma.reviewAudit.create).toHaveBeenCalledWith({
      data: { answerId: 'answer-1', action: 'approve', fromState: 'PENDING_REVIEW', toState: 'APPROVED', actorId: 'teacher-1' },
    });
  });

  it('approve(): omits editedContent from the write when not provided', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);

    await service.approve('answer-1', 'teacher-1');

    expect(prisma.answer.updateMany).toHaveBeenCalledWith({
      where: { id: 'answer-1', state: 'PENDING_REVIEW' },
      data: { state: 'APPROVED', reviewedById: 'teacher-1' },
    });
  });

  it('approve(): affected-count 0 (already moved / not pending) -> 409, and no audit row is written', async () => {
    const prisma = fakePrisma({ updateMany: jest.fn(async () => ({ count: 0 })) });
    const service = new ReviewService(prisma as any);

    await expect(service.approve('answer-1', 'teacher-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reviewAudit.create).not.toHaveBeenCalled();
  });

  it('approve(): a DB trigger rejection (check_violation) -> 409, not 500', async () => {
    const err = Object.assign(new Error('illegal answer state transition: APPROVED -> PENDING_REVIEW'), {
      code: 'P2010',
    });
    const prisma = fakePrisma({
      updateMany: jest.fn(async () => {
        throw err;
      }),
    });
    const service = new ReviewService(prisma as any);

    await expect(service.approve('answer-1', 'teacher-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve(): an unrelated DB error is NOT swallowed into a 409 — it propagates as-is', async () => {
    const prisma = fakePrisma({
      updateMany: jest.fn(async () => {
        throw new Error('connection reset by peer');
      }),
    });
    const service = new ReviewService(prisma as any);

    await expect(service.approve('answer-1', 'teacher-1')).rejects.toThrow('connection reset by peer');
    await expect(service.approve('answer-1', 'teacher-1')).rejects.not.toBeInstanceOf(ConflictException);
  });

  it('reject(): CAS success sets state=REJECTED + reviewedById and writes a reject audit row', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);

    await service.reject('answer-2', 'teacher-1', 'incorrect approach');

    expect(prisma.answer.updateMany).toHaveBeenCalledWith({
      where: { id: 'answer-2', state: 'PENDING_REVIEW' },
      data: { state: 'REJECTED', reviewedById: 'teacher-1' },
    });
    expect(prisma.reviewAudit.create).toHaveBeenCalledWith({
      data: { answerId: 'answer-2', action: 'reject', fromState: 'PENDING_REVIEW', toState: 'REJECTED', actorId: 'teacher-1' },
    });
  });

  it('reject(): affected-count 0 -> 409', async () => {
    const prisma = fakePrisma({ updateMany: jest.fn(async () => ({ count: 0 })) });
    const service = new ReviewService(prisma as any);

    await expect(service.reject('answer-2', 'teacher-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('edit(): same-state PENDING_REVIEW->PENDING_REVIEW updates editedContent and writes an edit audit (fromState=toState)', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);

    await service.edit('answer-3', 'teacher-1', 'corrected wording');

    expect(prisma.answer.updateMany).toHaveBeenCalledWith({
      where: { id: 'answer-3', state: 'PENDING_REVIEW' },
      data: { state: 'PENDING_REVIEW', editedContent: 'corrected wording', reviewedById: 'teacher-1' },
    });
    expect(prisma.reviewAudit.create).toHaveBeenCalledWith({
      data: { answerId: 'answer-3', action: 'edit', fromState: 'PENDING_REVIEW', toState: 'PENDING_REVIEW', actorId: 'teacher-1' },
    });
  });

  it('edit(): affected-count 0 -> 409', async () => {
    const prisma = fakePrisma({ updateMany: jest.fn(async () => ({ count: 0 })) });
    const service = new ReviewService(prisma as any);

    await expect(service.edit('answer-3', 'teacher-1', 'x')).rejects.toBeInstanceOf(ConflictException);
  });

  it('edit(): sanitizes control characters out of editedContent before persisting', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);
    const withEscape = 'plain ' + String.fromCharCode(0x1b) + '[31mred text';

    await service.edit('answer-3', 'teacher-1', withEscape);

    expect(prisma.answer.updateMany).toHaveBeenCalledWith({
      where: { id: 'answer-3', state: 'PENDING_REVIEW' },
      data: { state: 'PENDING_REVIEW', editedContent: 'plain [31mred text', reviewedById: 'teacher-1' },
    });
  });

  it('queue(): returns PENDING_REVIEW answers joined to their doubts, newest first', async () => {
    const prisma = fakePrisma();
    const service = new ReviewService(prisma as any);

    await service.queue();

    expect(prisma.answer.findMany).toHaveBeenCalledWith({
      where: { state: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'desc' },
      include: { doubt: { select: { id: true, title: true, body: true, authorId: true } } },
    });
  });
});
