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
