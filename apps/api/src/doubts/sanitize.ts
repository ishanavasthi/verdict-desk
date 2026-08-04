/** The web renders `editedContent` as plain text — bound its size defensively. 8 KB cap. */
export const MAX_EDITED_CONTENT_CHARS = 8 * 1024;

// Strips C0 controls (keeping ordinary tab, newline, carriage-return
// whitespace) plus the C1 control block including DEL. Built as a RegExp
// from unicode escapes so no literal control bytes live in this source.
const CONTROL_CHARS_RE = new RegExp(
  // eslint-disable-next-line no-control-regex -- intentional: this IS the control-char stripper.
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);

/**
 * PURE sanitizer for teacher-supplied `editedContent` (and similar free-text
 * review input): strips C0/C1 control characters (NUL, ESC-based ANSI
 * sequences, etc.) while preserving ordinary whitespace, then caps length.
 * The web renders this as plain text only, so control chars must never
 * reach it un-stripped.
 */
export function sanitizeContent(input: string, maxLen: number = MAX_EDITED_CONTENT_CHARS): string {
  const stripped = input.replace(CONTROL_CHARS_RE, '');
  return stripped.slice(0, maxLen);
}
