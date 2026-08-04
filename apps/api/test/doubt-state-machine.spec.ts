import { canInsertAnswer, isAllowedTransition } from '../src/doubts/state-machine';

describe('isAllowedTransition (mirrors answers_transition_guard_trg)', () => {
  it('allows DRAFT -> PENDING_REVIEW', () => {
    expect(isAllowedTransition('DRAFT', 'PENDING_REVIEW')).toBe(true);
  });

  it('allows PENDING_REVIEW -> APPROVED', () => {
    expect(isAllowedTransition('PENDING_REVIEW', 'APPROVED')).toBe(true);
  });

  it('allows PENDING_REVIEW -> REJECTED', () => {
    expect(isAllowedTransition('PENDING_REVIEW', 'REJECTED')).toBe(true);
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const)(
    'allows same-state %s -> %s (a content edit, not a state change)',
    (state) => {
      expect(isAllowedTransition(state, state)).toBe(true);
    },
  );

  it('rejects REJECTED -> APPROVED (REJECTED is terminal)', () => {
    expect(isAllowedTransition('REJECTED', 'APPROVED')).toBe(false);
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const)(
    'rejects APPROVED -> %s (APPROVED is terminal)',
    (to) => {
      expect(isAllowedTransition('APPROVED', to)).toBe(false);
    },
  );

  it('rejects DRAFT -> APPROVED (must pass through PENDING_REVIEW)', () => {
    expect(isAllowedTransition('DRAFT', 'APPROVED')).toBe(false);
  });

  it('rejects DRAFT -> REJECTED (must pass through PENDING_REVIEW)', () => {
    expect(isAllowedTransition('DRAFT', 'REJECTED')).toBe(false);
  });

  it('rejects PENDING_REVIEW -> DRAFT (no going backwards)', () => {
    expect(isAllowedTransition('PENDING_REVIEW', 'DRAFT')).toBe(false);
  });

  it('rejects REJECTED -> DRAFT / PENDING_REVIEW (REJECTED is terminal)', () => {
    expect(isAllowedTransition('REJECTED', 'DRAFT')).toBe(false);
    expect(isAllowedTransition('REJECTED', 'PENDING_REVIEW')).toBe(false);
  });
});

describe('canInsertAnswer (mirrors answers_insert_guard_trg)', () => {
  it('allows an AI-authored answer born DRAFT', () => {
    expect(canInsertAnswer('AI', 'DRAFT')).toBe(true);
  });

  it('rejects an AI-authored answer born anything other than DRAFT', () => {
    expect(canInsertAnswer('AI', 'PENDING_REVIEW')).toBe(false);
    expect(canInsertAnswer('AI', 'APPROVED')).toBe(false);
    expect(canInsertAnswer('AI', 'REJECTED')).toBe(false);
  });

  it('rejects a non-TEACHER (AI) answer born APPROVED', () => {
    expect(canInsertAnswer('AI', 'APPROVED')).toBe(false);
  });

  it('allows a TEACHER-authored answer born APPROVED', () => {
    expect(canInsertAnswer('TEACHER', 'APPROVED')).toBe(true);
  });

  it('allows a TEACHER-authored answer born in any other state too', () => {
    expect(canInsertAnswer('TEACHER', 'DRAFT')).toBe(true);
    expect(canInsertAnswer('TEACHER', 'PENDING_REVIEW')).toBe(true);
    expect(canInsertAnswer('TEACHER', 'REJECTED')).toBe(true);
  });
});
