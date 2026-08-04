import { isTriggerGuardError } from '../src/doubts/db-conflict';

describe('isTriggerGuardError', () => {
  it('recognizes a Prisma-known-request-error shape (code P2010, raw query failure)', () => {
    const err = Object.assign(new Error('Raw query failed'), { code: 'P2010' });
    expect(isTriggerGuardError(err)).toBe(true);
  });

  it('recognizes an insert-guard trigger message even without a Prisma error code', () => {
    const err = new Error(
      'illegal answer insert: AI-authored answers must be born DRAFT (got APPROVED)',
    );
    expect(isTriggerGuardError(err)).toBe(true);
  });

  it('recognizes a transition-guard trigger message even without a Prisma error code', () => {
    const err = new Error('illegal answer state transition: APPROVED -> PENDING_REVIEW');
    expect(isTriggerGuardError(err)).toBe(true);
  });

  it('recognizes the raw Postgres SQLSTATE (23514, check_violation) embedded in a message', () => {
    expect(isTriggerGuardError(new Error('ERROR: 23514: check_violation'))).toBe(true);
    expect(isTriggerGuardError(new Error('SQLSTATE[23514]: something'))).toBe(true);
  });

  it('does not misclassify an unrelated DB error (e.g. connection reset)', () => {
    expect(isTriggerGuardError(new Error('connection reset by peer'))).toBe(false);
  });

  it('does not misclassify an unrelated Prisma error code (e.g. P2002 unique constraint)', () => {
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    expect(isTriggerGuardError(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isTriggerGuardError(null)).toBe(false);
    expect(isTriggerGuardError(undefined)).toBe(false);
    expect(isTriggerGuardError('plain string, no error shape')).toBe(false);
    expect(isTriggerGuardError({ foo: 'bar' })).toBe(false);
  });

  it('recognizes a plain string message too', () => {
    expect(isTriggerGuardError('illegal answer state transition: REJECTED -> APPROVED')).toBe(true);
  });
});
