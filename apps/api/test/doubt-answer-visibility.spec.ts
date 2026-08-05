import { readableAnswerContent, visibleAnswerWhere } from '../src/doubts/answer-visibility';

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

describe('readableAnswerContent', () => {
  const draft = { content: 'raw AI draft text', editedContent: null };

  // The doubt's OWN author receives these rows (visibleAnswerWhere returns them
  // so the UI can show a draft exists) — the text must still be withheld.
  it.each(['PENDING_REVIEW', 'DRAFT', 'REJECTED'])(
    'withholds the text of a %s answer from a student',
    (state) => {
      expect(readableAnswerContent({ role: 'STUDENT' }, { state, ...draft })).toBeNull();
    },
  );

  it('returns the text of an APPROVED answer to a student', () => {
    expect(readableAnswerContent({ role: 'STUDENT' }, { state: 'APPROVED', ...draft })).toBe(
      'raw AI draft text',
    );
  });

  it("prefers a teacher's edit over the raw draft, so an edit is never cosmetic", () => {
    expect(
      readableAnswerContent(
        { role: 'STUDENT' },
        { state: 'APPROVED', content: 'raw AI draft text', editedContent: 'vetted text' },
      ),
    ).toBe('vetted text');
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])(
    'gives a TEACHER the text in state %s (they are the reviewer)',
    (state) => {
      expect(readableAnswerContent({ role: 'TEACHER' }, { state, ...draft })).toBe('raw AI draft text');
    },
  );
});
