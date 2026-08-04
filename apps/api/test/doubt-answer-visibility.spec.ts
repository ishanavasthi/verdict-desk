import { visibleAnswerWhere } from '../src/doubts/answer-visibility';

describe('visibleAnswerWhere', () => {
  it('imposes no restriction for a TEACHER (sees every answer, any state)', () => {
    const where = visibleAnswerWhere({ id: 'teacher-1', role: 'TEACHER' });
    expect(where).toEqual({});
  });

  it('restricts a STUDENT to APPROVED answers OR answers on their own doubt', () => {
    const where = visibleAnswerWhere({ id: 'student-1', role: 'STUDENT' });
    expect(where).toEqual({
      OR: [{ state: 'APPROVED' }, { doubt: { authorId: 'student-1' } }],
    });
  });

  it('scopes the "own doubt" clause to the specific viewer id', () => {
    const where = visibleAnswerWhere({ id: 'student-2', role: 'STUDENT' });
    expect(where).toEqual({
      OR: [{ state: 'APPROVED' }, { doubt: { authorId: 'student-2' } }],
    });
  });
});
