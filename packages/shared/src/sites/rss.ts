/**
 * RSS 2.0 builder for a site's blog feed (docs/SEO.md). Pure, so the escaping
 * is unit tested; the API feed endpoint and the web feed route both use it.
 * Every value is tenant input and is escaped; characters XML 1.0 cannot carry
 * at all are dropped.
 */

export interface RssItem {
  title: string;
  link: string;
  description: string;
  /** ISO 8601. */
  publishedAt: string;
  author?: string | null;
  categories?: readonly string[];
}

export interface RssChannel {
  title: string;
  /** The blog index URL. */
  link: string;
  /** The feed's own URL (atom:link rel="self"). */
  selfUrl: string;
  description: string;
  /** BCP 47 code of the feed's language. */
  language: string;
  items: readonly RssItem[];
}

// XML 1.0 forbids C0 controls other than tab, newline and carriage return, lone surrogates and U+FFFE/U+FFFF.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXmlText(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 date as RSS 2.0 requires (`Wed, 01 Oct 2026 09:00:00 GMT`). */
export function rssDate(iso: string): string {
  return new Date(iso).toUTCString();
}

function element(name: string, value: string): string {
  return `<${name}>${escapeXmlText(value)}</${name}>`;
}

export function buildRssXml(channel: RssChannel): string {
  const items = channel.items
    .map((item) => {
      const categories = (item.categories ?? []).map((c) => element('category', c)).join('');
      // dc:creator carries a display name; RSS <author> would need an email address.
      const author = item.author ? element('dc:creator', item.author) : '';
      return (
        '<item>' +
        element('title', item.title) +
        element('link', item.link) +
        `<guid isPermaLink="true">${escapeXmlText(item.link)}</guid>` +
        element('description', item.description) +
        element('pubDate', rssDate(item.publishedAt)) +
        author +
        categories +
        '</item>'
      );
    })
    .join('');
  const lastBuild = channel.items[0] ? element('lastBuildDate', rssDate(channel.items[0].publishedAt)) : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<channel>' +
    element('title', channel.title) +
    element('link', channel.link) +
    `<atom:link href="${escapeXmlText(channel.selfUrl)}" rel="self" type="application/rss+xml"/>` +
    element('description', channel.description) +
    element('language', channel.language) +
    lastBuild +
    items +
    '</channel></rss>'
  );
}
