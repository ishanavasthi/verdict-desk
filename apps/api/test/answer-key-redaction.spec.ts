import { ProblemsController } from '../src/problems/problems.controller';
import { SubmissionsController } from '../src/submissions/submissions.controller';

/**
 * `answerKey` has the same secrecy status as hidden test-case expected
 * outputs: it must never appear in any student-facing response, for either
 * problems or submissions.
 */
describe('answerKey redaction', () => {
  const user = { id: 'user-1', role: 'STUDENT' } as const;

  it('problems list select never requests answerKey', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', title: 'Docker Network Isolation', difficulty: 'easy', kind: 'MCQ' },
    ]);
    const controller = new ProblemsController({ problem: { findMany } } as any);

    const result = await controller.list();

    expect(JSON.stringify(result)).not.toContain('answerKey');
    const selectArg = findMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty('answerKey');
  });

  it('problems detail select never requests answerKey and returns options only for MCQ', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'p1',
      title: 'Docker Network Isolation',
      description: 'which flag...',
      difficulty: 'easy',
      kind: 'MCQ',
      options: [{ id: 'a', text: '--network none' }],
      testCases: [],
    });
    const controller = new ProblemsController({ problem: { findUnique } } as any);

    const result = await controller.detail('p1');

    expect(JSON.stringify(result)).not.toContain('answerKey');
    const selectArg = findUnique.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty('answerKey');
    expect(result.options).toEqual([{ id: 'a', text: '--network none' }]);
  });

  it('submission view never contains answerKey', async () => {
    const prisma = {
      submission: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sub-1',
          problemId: 'p1',
          status: 'PASSED',
          score: 100,
          code: 'a',
          testResults: [],
          aiFeedback: null,
          problem: { kind: 'MCQ' },
        }),
      },
    };
    const controller = new SubmissionsController(prisma as any, {} as any, {} as any);

    const result = await controller.get('sub-1', user as any);

    expect(JSON.stringify(result)).not.toContain('answerKey');
    expect(result.problemKind).toBe('MCQ');
    expect(result.submittedAnswer).toBe('a');
    expect(result.feedbackStatus).toBe('SKIPPED');
  });

  it('submission view for a CODE submission has null submittedAnswer', async () => {
    const prisma = {
      submission: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sub-2',
          problemId: 'p2',
          status: 'PASSED',
          score: 100,
          code: 'console.log(1)',
          testResults: [],
          aiFeedback: null,
          problem: { kind: 'CODE' },
        }),
      },
    };
    const controller = new SubmissionsController(prisma as any, {} as any, {} as any);

    const result = await controller.get('sub-2', user as any);

    expect(result.problemKind).toBe('CODE');
    expect(result.submittedAnswer).toBeNull();
    expect(result.feedbackStatus).toBe('PENDING');
  });
});
