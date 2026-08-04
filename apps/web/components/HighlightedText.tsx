/**
 * Renders untrusted text as PLAIN TEXT ONLY, with any `http(s)://` URLs
 * visually flagged (wrapped in a non-interactive `<mark>`) so a reviewer
 * notices possible exfiltration/phishing links.
 *
 * SECURITY: this never uses `dangerouslySetInnerHTML`, never parses
 * markdown, and never emits a clickable `<a href>` — matches are plain
 * strings placed into a `<mark>` React element, so the text itself can't
 * be interpreted as markup. Used in the teacher review view, where seeing
 * a raw AI draft / student doubt body with URLs called out matters most.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
// Trim common sentence-ending punctuation off the end of a matched URL so
// "see http://example.com." highlights the URL without the trailing period.
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

export default function HighlightedText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const regex = new RegExp(URL_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING_PUNCTUATION, '');
    const trailing = raw.slice(trimmed.length);

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (trimmed.length > 0) {
      nodes.push(
        <mark key={key++} className="url-highlight" title="URL detected in this text — not a link">
          {trimmed}
        </mark>,
      );
    }
    if (trailing) {
      nodes.push(trailing);
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <p className="plain-text">{nodes}</p>;
}
