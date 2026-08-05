/**
 * The doubts detail response must surface `reviewNote` on each answer (set
 * by ReviewService.reject onto Answer.reviewNote) so a REJECTED answer's
 * rejection reason reaches the doubt author — visibility is unchanged,
 * still governed entirely by `visibleAnswerWhere`.
 */
import { DoubtsController } from '../src/doubts/doubts.controller';

function fakePrisma(answer: Record<string, unknown>) {
  return {
    doubt: {
      findUnique: jest.fn(async () => ({
        id: 'doubt-1',
        problemId: null,
        authorId: 'student-1',
        title: 'Why does this fail?',
        body: 'body text',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        answers: [answer],
      })),
    },
  };
}

describe('DoubtsController.get() — reviewNote passthrough', () => {
  it('includes reviewNote in the answer payload when set', async () => {
    const prisma = fakePrisma({
      id: 'answer-1',
      authorType: 'AI',
      state: 'REJECTED',
      content: 'draft text',
      editedContent: null,
      reviewNote: 'incorrect approach',
      reviewedById: 'teacher-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const controller = new DoubtsController(prisma as any, { run: jest.fn() } as any);

    const result = await controller.get('doubt-1', { id: 'student-1', role: 'STUDENT' } as any);

    expect(result.answers[0].reviewNote).toBe('incorrect approach');
  });

  it('is null when the answer has no review note', async () => {
    const prisma = fakePrisma({
      id: 'answer-2',
      authorType: 'AI',
      state: 'APPROVED',
      content: 'draft text',
      editedContent: null,
      reviewNote: null,
      reviewedById: 'teacher-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    });
    const controller = new DoubtsController(prisma as any, { run: jest.fn() } as any);

    const result = await controller.get('doubt-1', { id: 'student-1', role: 'STUDENT' } as any);

    expect(result.answers[0].reviewNote).toBeNull();
  });
});

/**
 * The controller-boundary half of the redaction rule (the rule itself is unit
 * tested in doubt-answer-visibility.spec.ts). These assert on the ACTUAL
 * serialized response, since that — not the helper — is what ships to a client:
 * the author of a doubt is the one viewer who receives non-approved answer rows
 * at all, so they are the one who could be leaked to.
 */
describe('DoubtsController.get() — non-approved content is withheld from students', () => {
  const author = { id: 'student-1', role: 'STUDENT' } as any;
  const teacher = { id: 'teacher-1', role: 'TEACHER' } as any;

  const answerIn = (state: string) => ({
    id: 'answer-1',
    authorType: 'AI',
    state,
    content: 'UNREVIEWED AI TEXT',
    editedContent: null,
    reviewNote: null,
    reviewedById: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  });

  it.each(['PENDING_REVIEW', 'DRAFT', 'REJECTED'])(
    'returns a %s answer to its own author WITHOUT the text',
    async (state) => {
      const controller = new DoubtsController(fakePrisma(answerIn(state)) as any, { run: jest.fn() } as any);

      const result = await controller.get('doubt-1', author);

      // The row still ships (the author may know a draft exists + its state)...
      expect(result.answers).toHaveLength(1);
      expect(result.answers[0].state).toBe(state);
      // ...but the words never do.
      expect(result.answers[0].content).toBeNull();
      expect(JSON.stringify(result)).not.toContain('UNREVIEWED AI TEXT');
    },
  );

  it('returns the text once the answer is APPROVED', async () => {
    const controller = new DoubtsController(fakePrisma(answerIn('APPROVED')) as any, { run: jest.fn() } as any);

    const result = await controller.get('doubt-1', author);

    expect(result.answers[0].content).toBe('UNREVIEWED AI TEXT');
  });

  it('still gives a TEACHER the pending text (they are the reviewer)', async () => {
    const controller = new DoubtsController(
      fakePrisma(answerIn('PENDING_REVIEW')) as any,
      { run: jest.fn() } as any,
    );

    const result = await controller.get('doubt-1', teacher);

    expect(result.answers[0].content).toBe('UNREVIEWED AI TEXT');
  });

  it('never serializes reviewedById to a student', async () => {
    const controller = new DoubtsController(fakePrisma(answerIn('APPROVED')) as any, { run: jest.fn() } as any);

    const result = await controller.get('doubt-1', author);

    expect(result.answers[0]).not.toHaveProperty('reviewedById');
  });
});
