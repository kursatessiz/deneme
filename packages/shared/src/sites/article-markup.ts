/**
 * The article body markup subset (docs/SAYFA_MOTORU.md "Yazılar / blog").
 *
 * The body is plain text. Paragraphs are separated by blank lines; on top of
 * that a deliberately small subset is recognised:
 *   - `## ` at the start of a line: a section heading
 *   - `- ` at the start of a line: a bullet list item (consecutive lines form one list)
 *   - `[text](https://...)`: a link, https only; anything else stays plain text
 *   - `**text**`: bold
 *
 * There is no HTML passthrough: the parser returns a typed tree, and the web
 * renderer turns every text node into a React text child (escaped by React).
 * The same tree feeds the plain-text excerpt and the reading time.
 */

export type ArticleInlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: ArticleInlineNode[] }
  | { type: 'link'; href: string; children: ArticleInlineNode[] };

export type ArticleBlockNode =
  | { type: 'heading'; children: ArticleInlineNode[] }
  | { type: 'paragraph'; lines: ArticleInlineNode[][] }
  | { type: 'list'; items: ArticleInlineNode[][] };

/** Words per minute used for `readingMinutes`. */
export const ARTICLE_WORDS_PER_MINUTE = 200;

/**
 * Absolute https link: a dotted host name (no credentials, no IP literal brackets), optional port,
 * then an optional path, query or fragment without whitespace, quotes, angle brackets or backslashes.
 */
const SAFE_HTTPS_HREF = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?(?:[/?#][^\s"'<>\\`]*)?$/i;

/**
 * The link target when it is an absolute https URL, null otherwise: `javascript:`, `data:`, `http:`,
 * protocol-relative, relative and credential-carrying (`user@host`) links are all rejected.
 */
export function safeArticleHref(raw: string): string | null {
  const value = raw.trim();
  return SAFE_HTTPS_HREF.test(value) ? value : null;
}

// `**bold**` (non-greedy, no newline) or `[label](target)`. The label and target classes exclude the
// bracket characters themselves so a run of unmatched brackets fails at once instead of rescanning the
// rest of the line from every bracket (linear time on hostile input; CodeQL js/polynomial-redos).
const INLINE_PATTERN = /\*\*([^*\n]+?)\*\*|\[([^[\]\n]+)\]\(([^)\s[\]]+)\)/g;

function pushText(out: ArticleInlineNode[], value: string): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

/** Inline markup of one line. `allowStrong` / `allowLink` stop nesting a node in itself. */
export function parseArticleInline(text: string, allowStrong = true, allowLink = true): ArticleInlineNode[] {
  const out: ArticleInlineNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    pushText(out, text.slice(cursor, index));
    cursor = index + match[0].length;
    if (match[1] !== undefined) {
      if (allowStrong) out.push({ type: 'strong', children: parseArticleInline(match[1], false, allowLink) });
      else pushText(out, match[0]);
      continue;
    }
    const label = match[2];
    const href = safeArticleHref(match[3]);
    if (allowLink && href) out.push({ type: 'link', href, children: parseArticleInline(label, allowStrong, false) });
    else pushText(out, label); // an unsafe or nested link keeps only its visible text
  }
  pushText(out, text.slice(cursor));
  return out;
}

/** Parses an article body into blocks. Never throws: unknown syntax is plain text. */
export function parseArticleBody(body: string): ArticleBlockNode[] {
  const blocks: ArticleBlockNode[] = [];
  let paragraph: ArticleInlineNode[][] | null = null;
  let list: ArticleInlineNode[][] | null = null;
  const flush = () => {
    if (paragraph) blocks.push({ type: 'paragraph', lines: paragraph });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = null;
    list = null;
  };

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const text = line.slice(3).trim();
      if (text) blocks.push({ type: 'heading', children: parseArticleInline(text) });
      continue;
    }
    if (line.startsWith('- ')) {
      if (paragraph) flush();
      const text = line.slice(2).trim();
      if (!text) continue;
      if (!list) list = [];
      list.push(parseArticleInline(text));
      continue;
    }
    if (list) flush();
    if (!paragraph) paragraph = [];
    paragraph.push(parseArticleInline(line));
  }
  flush();
  return blocks;
}

function inlineText(nodes: readonly ArticleInlineNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : inlineText(n.children))).join('');
}

/** The body as plain text (markup removed, blocks separated by blank lines), for excerpts, feeds and reading time. */
export function articlePlainText(body: string): string {
  return parseArticleBody(body)
    .map((block) => {
      if (block.type === 'heading') return inlineText(block.children);
      if (block.type === 'paragraph') return block.lines.map(inlineText).join('\n');
      return block.items.map(inlineText).join('\n');
    })
    .join('\n\n');
}

/** Reading time in whole minutes, at least 1. */
export function computeReadingMinutes(body: string): number {
  const words = articlePlainText(body).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / ARTICLE_WORDS_PER_MINUTE));
}

/** First `maxLength` characters of the plain text, cut at a word boundary, with an ellipsis when cut. */
export function articleSummary(body: string, maxLength = 200): string {
  const text = articlePlainText(body).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Link targets in the body that the renderer would drop (not https). Used to reject them on write. */
export function unsafeArticleLinks(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(INLINE_PATTERN)) {
    if (match[1] !== undefined) out.push(...unsafeArticleLinks(match[1]));
    else if (match[3] !== undefined && !safeArticleHref(match[3])) out.push(match[3]);
  }
  return out;
}
