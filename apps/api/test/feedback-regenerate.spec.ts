import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubmissionsController } from '../src/submissions/submissions.controller';

/**
 * Unit tests for POST /submissions/:id/feedback/regenerate: ownership is
 * enforced exactly like get() (non-owner -> 404, existence never leaked),
 * regeneration is only allowed from the FAILED feedback-generation state
 * (anything else -> 409), and the happy path deletes the stale row and
 * fires generation without awaiting it.
 */
describe('SubmissionsController.regenerateFeedback', () => {
  const owner = { id: 'user-1', role: 'STUDENT' } as const;

  function makeController(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      submission: {
        findFirst: jest.fn(),
      },
      aiFeedback: {
        delete: jest.fn().mockResolvedValue({}),
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
    ['PENDING', { status: 'PASSED', aiFeedback: null }],
    ['SKIPPED', { status: 'ERROR', aiFeedback: null }],
  ])('409s when feedback status is %s (not FAILED)', async (_label, submission) => {
    const { controller, prisma, aiFeedback } = makeController();
    (prisma.submission.findFirst as jest.Mock).mockResolvedValue({ id: 'sub-1', ...submission });

    await expect(controller.regenerateFeedback('sub-1', owner as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.aiFeedback.delete).not.toHaveBeenCalled();
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
    expect(prisma.aiFeedback.delete).toHaveBeenCalledWith({ where: { submissionId: 'sub-1' } });
    expect(aiFeedback.generateForSubmission).toHaveBeenCalledWith('sub-1');
  });
});
