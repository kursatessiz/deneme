/**
 * Privacy helpers of the marketing studio (docs/PAZARLAMA_MODULU.md 4.4):
 * PII redaction for free text that reaches the model and k-anonymous
 * aggregation for everything derived from the CRM. Both are pure.
 */

/** A cell of an aggregate is only shown when at least this many contacts fall into it. */
export const MARKETING_MIN_CELL = 5;

const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const EMAIL_LABEL_CHAR = /[A-Za-z0-9-]/;

export const REDACTED_EMAIL = '[email]';
export const REDACTED_PHONE = '[phone]';

/**
 * Masks `local@label(.label)+` addresses with a single left-to-right scan
 * around each `@`. Equivalent to the greedy regex
 * `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+`, but linear in the
 * input length: an unanchored regex of that shape backtracks quadratically
 * on long runs of local-part characters without an `@`.
 */
function redactEmails(text: string): string {
  let out = '';
  let last = 0;
  let at = text.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > last && EMAIL_LOCAL_CHAR.test(text[start - 1] ?? '')) start--;
    let end = at + 1;
    let labels = 0;
    for (;;) {
      const labelStart = end;
      while (end < text.length && EMAIL_LABEL_CHAR.test(text[end] ?? '')) end++;
      if (end === labelStart) {
        // No label after the `@` or after a dot: the dot is not part of the address.
        end = labelStart - 1;
        break;
      }
      labels++;
      if (text[end] === '.') {
        end++;
        continue;
      }
      break;
    }
    if (start < at && labels >= 2) {
      out += text.slice(last, start) + REDACTED_EMAIL;
      last = end;
      at = text.indexOf('@', end);
    } else {
      at = text.indexOf('@', at + 1);
    }
  }
  return out + text.slice(last);
}

/**
 * Replaces e-mail addresses and phone-like digit runs (7 or more digits)
 * with neutral markers. Applied to every free-text field of a brief and to
 * pasted research sources before they are put into a prompt, so a person's
 * contact details never reach the model even if someone types them in.
 */
export function redactPii(text: string): string {
  return redactEmails(text).replace(PHONE_RE, (match) => {
    if (ISO_DATE_RE.test(match)) return match;
    return match.replace(/\D/g, '').length >= 7 ? REDACTED_PHONE : match;
  });
}

/** True when the text still contains an e-mail address or a phone-like number. */
export function containsPii(text: string): boolean {
  return redactPii(text) !== text;
}

export interface AggregateCell {
  label: string;
  count: number;
}

export interface SuppressedCells {
  cells: AggregateCell[];
  /** Sum of the suppressed cells, reported only when it alone reaches k (otherwise 0, so differencing reveals nothing). */
  otherCount: number;
}

/**
 * k-anonymity for one dimension: cells below `k` are dropped; their sum is
 * kept as "other" only when that sum itself is at least `k`. Result cells
 * are sorted by count (descending) then label.
 */
export function suppressSmallCells(cells: readonly AggregateCell[], k: number = MARKETING_MIN_CELL): SuppressedCells {
  const shown: AggregateCell[] = [];
  let hidden = 0;
  for (const cell of cells) {
    if (cell.count >= k) shown.push({ label: cell.label, count: cell.count });
    else hidden += cell.count;
  }
  shown.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { cells: shown, otherCount: hidden >= k ? hidden : 0 };
}

/** A count for display: exact when at least k, otherwise null ("fewer than k"). */
export function countOrNull(count: number, k: number = MARKETING_MIN_CELL): number | null {
  return count >= k ? count : null;
}

/**
 * Labels that come from free text (UTM sources, custom fields) are only used
 * as aggregate labels when they cannot identify a person: short, no e-mail
 * or phone-like content, no long digit runs.
 */
export function safeAggregateLabel(raw: string | null | undefined, fallback: string): string {
  const label = (raw ?? '').trim();
  if (label === '' || label.length > 40) return fallback;
  if (containsPii(label) || /\d{5,}/.test(label)) return fallback;
  return label;
}
