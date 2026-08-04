import type { SubmissionStatus, TestResultStatus } from './api';

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
