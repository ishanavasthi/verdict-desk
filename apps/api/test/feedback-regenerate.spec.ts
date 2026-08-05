import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubmissionsController } from '../src/submissions/submissions.controller';

/**
 * Unit tests for POST /submissions/:id/feedback/regenerate: ownership is
 * enforced exactly like get() (non-owner -> 404, existence never leaked),
 * regeneration is allowed from the two recoverable states (FAILED, and PENDING
 * — which is where a submission gets STUCK if the fire-and-forget job died with
 * the process), anything else -> 409, and the happy path clears any stale row
 * and fires generation without awaiting it.
 */
describe('SubmissionsController.regenerateFeedback', () => {
  const owner = { id: 'user-1', role: 'STUDENT' } as const;

  function makeController(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      submission: {
        findFirst: jest.fn(),
      },
      aiFeedback: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...prismaOverrides,
    };
    const queue = {};
    const aiFeedback = {
      generateForSubmission: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SubmissionsController(prisma as any, queue as any, aiFeedback as any);
    return { controller, prisma, aiFeedback };
  }

  it('404s when the submission does not belong to the requesting user (existence not leaked)', async () => {
    const { controller, prisma } = makeController();
    (prisma.submission.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(controller.regenerateFeedback('sub-1', owner as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['READY', { status: 'PASSED', aiFeedback: { validationStatus: 'VALID' } }],
    ['SKIPPED', { status: 'ERROR', aiFeedback: null }],
  ])('409s when feedback status is %s (nothing to recover)', async (_label, submission) => {
    const { controller, prisma, aiFeedback } = makeController();
    (prisma.submission.findFirst as jest.Mock).mockResolvedValue({ id: 'sub-1', ...submission });

    await expect(controller.regenerateFeedback('sub-1', owner as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.aiFeedback.deleteMany).not.toHaveBeenCalled();
    expect(aiFeedback.generateForSubmission).not.toHaveBeenCalled();
  });

  it('deletes the flagged feedback row and fires regeneration when status is FAILED', async () => {
    const { controller, prisma, aiFeedback } = makeController();
    (prisma.submission.findFirst as jest.Mock).mockResolvedValue({
      id: 'sub-1',
      status: 'PASSED',
      aiFeedback: { validationStatus: 'FLAGGED' },
    });

    const result = await controller.regenerateFeedback('sub-1', owner as any);

    expect(result).toEqual({ id: 'sub-1', feedbackStatus: 'PENDING' });
    expect(prisma.aiFeedback.deleteMany).toHaveBeenCalledWith({ where: { submissionId: 'sub-1' } });
    expect(aiFeedback.generateForSubmission).toHaveBeenCalledWith('sub-1');
  });

  /**
   * The stuck case this endpoint exists to rescue: grading finished, then the
   * fire-and-forget feedback job died with the process, so no row was ever
   * written. `feedbackStatus` reports PENDING forever and the UI polls a job
   * that no longer exists — previously a 409, i.e. permanent.
   */
  it('re-fires generation for a submission STUCK at PENDING with no feedback row', async () => {
    const { controller, prisma, aiFeedback } = makeController();
    (prisma.submission.findFirst as jest.Mock).mockResolvedValue({
      id: 'sub-1',
      status: 'PASSED',
      aiFeedback: null,
    });

    const result = await controller.regenerateFeedback('sub-1', owner as any);

    expect(result).toEqual({ id: 'sub-1', feedbackStatus: 'PENDING' });
    // deleteMany tolerates the row being absent — `delete` would throw P2025.
    expect(prisma.aiFeedback.deleteMany).toHaveBeenCalledWith({ where: { submissionId: 'sub-1' } });
    expect(aiFeedback.generateForSubmission).toHaveBeenCalledWith('sub-1');
  });
});
