import { BadRequestException } from '@nestjs/common';
import { SubmissionsController } from '../src/submissions/submissions.controller';

/**
 * Unit tests for POST /submissions on MCQ/INTEGER problems: instant,
 * in-process grading with no queue/sandbox/LLM involvement, and never
 * leaking the answerKey (or valid option ids) on a malformed answer.
 */
describe('SubmissionsController.create (objective kinds)', () => {
  const user = { id: 'user-1', role: 'STUDENT' } as const;

  const mcqOptions = [
    { id: 'a', text: '--network none' },
    { id: 'b', text: '--isolate' },
    { id: 'c', text: '--no-net' },
    { id: 'd', text: '--offline' },
  ];

  function makeController(problem: unknown) {
    const prisma = {
      problem: { findUnique: jest.fn().mockResolvedValue(problem) },
      submission: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'sub-1', ...data }),
        ),
      },
    };
    const queue = { canAccept: jest.fn().mockReturnValue(true), enqueue: jest.fn() };
    const aiFeedback = {};
    const controller = new SubmissionsController(prisma as any, queue as any, aiFeedback as any);
    return { controller, prisma, queue };
  }

  it('correct MCQ answer -> PASSED/100, terminal, no enqueue', async () => {
    const { controller, prisma, queue } = makeController({
      kind: 'MCQ',
      options: mcqOptions,
      answerKey: 'a',
    });

    const result = await controller.create({ problemId: 'p1', code: 'a' } as any, user as any);

    expect(result.status).toBe('PASSED');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(prisma.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED', score: 100 }) }),
    );
  });

  it('wrong MCQ answer -> FAILED/0, terminal, no enqueue', async () => {
    const { controller, queue, prisma } = makeController({
      kind: 'MCQ',
      options: mcqOptions,
      answerKey: 'a',
    });

    const result = await controller.create({ problemId: 'p1', code: 'b' } as any, user as any);

    expect(result.status).toBe('FAILED');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(prisma.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', score: 0 }) }),
    );
  });

  it('malformed MCQ answer -> 400 whose message excludes the answerKey and option ids', async () => {
    const { controller, prisma } = makeController({
      kind: 'MCQ',
      options: mcqOptions,
      answerKey: 'a',
    });

    await expect(
      controller.create({ problemId: 'p1', code: 'z' } as any, user as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    try {
      await controller.create({ problemId: 'p1', code: 'z' } as any, user as any);
    } catch (err) {
      const message = (err as BadRequestException).message;
      expect(message).not.toContain('answerKey');
      expect(message).not.toMatch(/\boption\b|\bid\b|--network none/i);
    }
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it('correct INTEGER answer (with canonicalisation) -> PASSED/100', async () => {
    const { controller } = makeController({ kind: 'INTEGER', options: null, answerKey: '31' });

    const result = await controller.create({ problemId: 'p2', code: '031' } as any, user as any);

    expect(result.status).toBe('PASSED');
  });

  it('malformed INTEGER answer -> 400', async () => {
    const { controller } = makeController({ kind: 'INTEGER', options: null, answerKey: '31' });

    await expect(
      controller.create({ problemId: 'p2', code: 'not-a-number' } as any, user as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CODE kind still goes through the queue path unchanged', async () => {
    const prisma = {
      problem: { findUnique: jest.fn().mockResolvedValue({ kind: 'CODE', options: null, answerKey: null }) },
      submission: {
        create: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'QUEUED' }),
      },
    };
    const queue = { canAccept: jest.fn().mockReturnValue(true), enqueue: jest.fn() };
    const controller = new SubmissionsController(prisma as any, queue as any, {} as any);

    const result = await controller.create({ problemId: 'p3', code: 'console.log(1)' } as any, user as any);

    expect(result).toEqual({ id: 'sub-1', status: 'QUEUED' });
    expect(queue.enqueue).toHaveBeenCalledWith('sub-1');
  });
});
