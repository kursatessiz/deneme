/**
 * `llms.txt` (https://llmstxt.org): a Markdown file at the site root that tells language models what the site is
 * and where its main content lives. Built from data the site already publishes (docs/SEO.md "llms.txt"); every
 * value is tenant data or a translated label, so link text and descriptions are made safe for Markdown here.
 */

export interface LlmsLink {
  title: string;
  url: string;
  description?: string | null;
}

export interface LlmsSection {
  title: string;
  links: readonly LlmsLink[];
}

export interface LlmsDocument {
  /** Site or business name (the one H1). */
  name: string;
  /** One-line summary shown as the blockquote. */
  summary?: string | null;
  sections: readonly LlmsSection[];
}

/** Keeps a value on one line and free of the characters that would break a Markdown link or heading. */
export function llmsText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A link target is kept only when it is an absolute http(s) URL without whitespace or parentheses. */
function safeUrl(url: string): string | null {
  return /^https?:\/\/[^\s()<>]+$/.test(url) ? url : null;
}

export function buildLlmsTxt(doc: LlmsDocument): string {
  const lines: string[] = [`# ${llmsText(doc.name)}`];
  const summary = doc.summary ? llmsText(doc.summary) : '';
  if (summary) lines.push('', `> ${summary}`);
  for (const section of doc.sections) {
    const links = section.links
      .map((link) => {
        const url = safeUrl(link.url);
        const title = llmsText(link.title);
        if (!url || !title) return null;
        const description = link.description ? llmsText(link.description) : '';
        return description ? `- [${title}](${url}): ${description}` : `- [${title}](${url})`;
      })
      .filter((line): line is string => line !== null);
    if (links.length === 0) continue;
    lines.push('', `## ${llmsText(section.title)}`, '', ...links);
  }
  return `${lines.join('\n')}\n`;
}
