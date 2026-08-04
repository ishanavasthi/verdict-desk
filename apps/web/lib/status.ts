import type { AnswerAuthorType, AnswerState, FeedbackSeverity, SubmissionStatus, TestResultStatus } from './api';

/** Coarse visual outcome used by chips and the verdict stamp. */
export type Outcome = 'pass' | 'fail' | 'warn' | 'info' | 'pending';

/** Map any submission- or test-result status to a semantic outcome. */
export function statusOutcome(status: SubmissionStatus | TestResultStatus | string): Outcome {
  switch (status) {
    case 'PASSED':
    case 'PASS':
      return 'pass';
    case 'FAILED':
    case 'FAIL':
    case 'ERROR':
      return 'fail';
    case 'TIMEOUT':
      return 'warn';
    case 'QUEUED':
    case 'RUNNING':
      return 'pending';
    default:
      return 'pending';
  }
}

/** Map a feedback severity to a semantic outcome (for the severity chip). */
export function severityOutcome(severity: FeedbackSeverity): Outcome {
  switch (severity) {
    case 'info':
      return 'info';
    case 'low':
      return 'pass';
    case 'medium':
      return 'warn';
    case 'high':
      return 'fail';
    default:
      return 'info';
  }
}

/** Map an answer review-state to a semantic outcome (for the state chip). */
export function answerStateOutcome(state: AnswerState): Outcome {
  switch (state) {
    case 'APPROVED':
      return 'pass';
    case 'PENDING_REVIEW':
      return 'warn';
    case 'REJECTED':
      return 'fail';
    case 'DRAFT':
      return 'pending';
    default:
      return 'pending';
  }
}

/** The chip utility class for a given outcome (see globals.css). */
export function chipClass(outcome: Outcome): string {
  return `chip-${outcome === 'pending' ? 'muted' : outcome}`;
}

const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  PASSED: 'Passed',
  FAILED: 'Failed',
  ERROR: 'Error',
};

export function submissionStatusLabel(status: SubmissionStatus): string {
  return SUBMISSION_STATUS_LABEL[status] ?? status;
}

/** Maps any submission- or test-result-status string to a badge CSS class. */
export function statusBadgeClass(status: SubmissionStatus | TestResultStatus | string): string {
  switch (status) {
    case 'PASSED':
    case 'PASS':
      return 'badge-pass';
    case 'FAILED':
    case 'FAIL':
      return 'badge-fail';
    case 'TIMEOUT':
      return 'badge-timeout';
    case 'ERROR':
      return 'badge-err';
    case 'QUEUED':
    case 'RUNNING':
      return 'badge-pending';
    default:
      return 'badge-pending';
  }
}

const FEEDBACK_SEVERITY_LABEL: Record<FeedbackSeverity, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function feedbackSeverityLabel(severity: FeedbackSeverity): string {
  return FEEDBACK_SEVERITY_LABEL[severity] ?? severity;
}

const ANSWER_STATE_LABEL: Record<AnswerState, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export function answerStateLabel(state: AnswerState): string {
  return ANSWER_STATE_LABEL[state] ?? state;
}

/** Maps an answer's review state to a badge CSS class (see .badge-approved etc. in globals.css). */
export function answerStateBadgeClass(state: AnswerState): string {
  switch (state) {
    case 'APPROVED':
      return 'badge-approved';
    case 'PENDING_REVIEW':
      return 'badge-pending-review';
    case 'REJECTED':
      return 'badge-rejected';
    case 'DRAFT':
      return 'badge-draft';
    default:
      return 'badge-pending';
  }
}

const ANSWER_AUTHOR_TYPE_LABEL: Record<AnswerAuthorType, string> = {
  AI: '\u{1F916} AI',
  TEACHER: '\u{1F464} Teacher',
};

export function answerAuthorTypeLabel(authorType: AnswerAuthorType): string {
  return ANSWER_AUTHOR_TYPE_LABEL[authorType] ?? authorType;
}
