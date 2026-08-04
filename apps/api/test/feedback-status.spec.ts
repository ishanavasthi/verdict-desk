import { computeFeedbackStatus } from '../src/submissions/submissions.controller';

/**
 * Locks in the mapping the client polls on: a missing feedback row means
 * "still coming" (PENDING) UNLESS the submission ERRORed (then it's SKIPPED —
 * grading.service.ts never fires feedback for infra errors); a present row is
 * terminal, READY when validated and FAILED when flagged.
 */
describe('computeFeedbackStatus', () => {
  it('is PENDING when no feedback row exists yet for a graded submission', () => {
    expect(computeFeedbackStatus('PASSED', null)).toBe('PENDING');
    expect(computeFeedbackStatus('FAILED', null)).toBe('PENDING');
  });

  it('is PENDING while the submission is still being graded', () => {
    expect(computeFeedbackStatus('QUEUED', null)).toBe('PENDING');
    expect(computeFeedbackStatus('RUNNING', null)).toBe('PENDING');
  });

  it('is SKIPPED for an ERRORed submission with no feedback row (never generated)', () => {
    expect(computeFeedbackStatus('ERROR', null)).toBe('SKIPPED');
  });

  it('is READY when a validated feedback row exists', () => {
    expect(computeFeedbackStatus('PASSED', { validationStatus: 'VALID' })).toBe('READY');
  });

  it('is FAILED when the feedback row is flagged (validation failed twice)', () => {
    expect(computeFeedbackStatus('PASSED', { validationStatus: 'FLAGGED' })).toBe('FAILED');
  });

  it('prefers a present row over submission status (row is authoritative)', () => {
    // Even an ERROR submission, if it somehow has a validated row, reads READY.
    expect(computeFeedbackStatus('ERROR', { validationStatus: 'VALID' })).toBe('READY');
  });
});
