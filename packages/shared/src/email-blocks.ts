import { z } from 'zod';
import { resolveTheme } from './design/tokens';
import type { TenantTheme } from './design/tokens';
import { isStoredThemeFamilyKey } from './design/themes';
import type { MessageParams } from './i18n/translator';
import { renderMessageText, renderMessageTextLenient } from './messaging-engine';

/**
 * Block-based email bodies (docs/MESAJLASMA.md, "E-posta blokları"). A
 * template stores a small typed block list; the renderer turns it into a
 * table-based, inline-styled HTML document plus a plain-text part. Used by
 * the API to send and by the web template editor for the live preview, so
 * both always produce the same output.
 *
 * Every text value is HTML-escaped; block text is plain text, never HTML.
 */

const URL_WITH_PLACEHOLDERS = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => /^(https?:\/\/|\{[a-zA-Z0-9_]+\})/.test(v), 'Bağlantı http(s):// ile veya bir {degisken} ile başlamalıdır');

export const EmailBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal('paragraph'), text: z.string().trim().min(1).max(5000) }).strict(),
  z.object({ type: z.literal('button'), label: z.string().trim().min(1).max(80), url: URL_WITH_PLACEHOLDERS }).strict(),
  z
    .object({
      type: z.literal('image'),
      src: z.string().trim().url().max(2000).refine((v) => v.startsWith('https://'), 'Görsel adresi https olmalıdır'),
      alt: z.string().trim().max(200).default(''),
      href: URL_WITH_PLACEHOLDERS.optional(),
    })
    .strict(),
  z.object({ type: z.literal('divider') }).strict(),
  z.object({ type: z.literal('footer'), text: z.string().trim().min(1).max(1000) }).strict(),
]);
export type EmailBlock = z.infer<typeof EmailBlockSchema>;
export const EmailBlocksSchema = z.array(EmailBlockSchema).min(1).max(50);
export const EMAIL_BLOCK_TYPES = ['heading', 'paragraph', 'button', 'image', 'divider', 'footer'] as const;
export type EmailBlockType = (typeof EMAIL_BLOCK_TYPES)[number];

/** Tenant brand for the email chrome: logo, primary colour and the theme family's type and neutrals (always light). */
export interface EmailBrand {
  studioName: string;
  logoUrl: string | null;
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  fontFamily: string;
  headingFontFamily: string;
  buttonRadius: number;
}

export function emailBrandOf(studio: {
  name: string;
  logoUrl?: string | null;
  themeFamily?: string | null;
  themePrimary?: string | null;
  gradientPresetKey?: string | null;
}): EmailBrand {
  const tenant: Partial<TenantTheme> = { logoUrl: studio.logoUrl ?? null };
  if (isStoredThemeFamilyKey(studio.themeFamily)) tenant.themeFamily = studio.themeFamily;
  if (studio.themePrimary) tenant.themePrimary = studio.themePrimary;
  const theme = resolveTheme({ tenant, appearance: null, systemMode: 'light' });
  const logo = studio.logoUrl && /^https:\/\//.test(studio.logoUrl) ? studio.logoUrl : null;
  return {
    studioName: studio.name,
    logoUrl: logo,
    primary: theme.colors.primary,
    onPrimary: theme.colors.onPrimary,
    background: theme.colors.background,
    surface: theme.colors.surface,
    border: theme.colors.border,
    textPrimary: theme.colors.textPrimary,
    textSecondary: theme.colors.textSecondary,
    fontFamily: `${theme.family.fonts.body.web}, Arial, sans-serif`,
    headingFontFamily: `${theme.family.fonts.display.web}, Arial, sans-serif`,
    buttonRadius: Math.min(theme.family.radii.button, 24),
  };
}

export interface EmailFooter {
  /** The tenant's physical address (CAN-SPAM); always printed when known. */
  physicalAddress: string | null;
  /** Why the recipient gets this email (already translated). */
  reasonText: string;
  /** Present for COMMERCIAL mail: the unsubscribe page link and its label. */
  unsubscribe: { url: string; label: string } | null;
}

export interface RenderEmailInput {
  lang: string;
  subject: string;
  /** Short hidden preview text shown by inbox lists. */
  preheader?: string | null;
  blocks: readonly EmailBlock[];
  brand: EmailBrand;
  footer: EmailFooter;
  /** 1x1 open-tracking pixel (COMMERCIAL only). */
  openPixelUrl?: string | null;
  /** Click tracking: maps an original http(s) URL to its tracking URL. */
  rewriteLink?: (url: string) => string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only absolute http(s) URLs are ever put into an href or src. */
export function isSafeHttpUrl(value: string): boolean {
  // An absolute http(s) URL with a host and no whitespace, quotes or angle brackets.
  return value.length <= 2000 && /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?([/?#][^\s"'<>\\]*)?$/i.test(value);
}

/** Interpolates every text and URL of the block list (strict: missing variables throw). */
export function interpolateEmailBlocks(blocks: readonly EmailBlock[], variables: MessageParams, locale?: string, lenient = false): EmailBlock[] {
  const r = (s: string) => (lenient ? renderMessageTextLenient(s, variables, locale) : renderMessageText(s, variables, locale));
  return blocks.map((b): EmailBlock => {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      case 'footer':
        return { ...b, text: r(b.text) };
      case 'button':
        return { ...b, label: r(b.label), url: r(b.url) };
      case 'image':
        return { ...b, alt: r(b.alt), ...(b.href ? { href: r(b.href) } : {}) };
      case 'divider':
        return b;
    }
  });
}

/** Distinct http(s) link targets of a block list (buttons and linked images), for click tracking. */
export function emailLinkTargets(blocks: readonly EmailBlock[]): string[] {
  const urls = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'button' && isSafeHttpUrl(b.url)) urls.add(b.url);
    if (b.type === 'image' && b.href && isSafeHttpUrl(b.href)) urls.add(b.href);
  }
  return [...urls];
}

function paragraphHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

/**
 * Responsive, inline-styled HTML (tables, 600px max, fluid under 620px) and
 * a plain-text part. Unsafe URLs are dropped rather than rendered.
 */
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const { brand, footer } = input;
  const rewrite = input.rewriteLink ?? ((u: string) => u);
  const rows: string[] = [];
  const text: string[] = [];

  const cell = (inner: string, pad = '0 32px 16px 32px') => `<tr><td class="px" style="padding:${pad};">${inner}</td></tr>`;

  for (const block of input.blocks) {
    switch (block.type) {
      case 'heading':
        rows.push(
          cell(
            `<h1 style="margin:0;font-family:${escapeHtml(brand.headingFontFamily)};font-size:24px;line-height:32px;font-weight:700;color:${brand.textPrimary};">${escapeHtml(block.text)}</h1>`,
            '8px 32px 16px 32px',
          ),
        );
        text.push(block.text, '');
        break;
      case 'paragraph':
        rows.push(
          cell(
            `<p style="margin:0;font-family:${escapeHtml(brand.fontFamily)};font-size:16px;line-height:24px;color:${brand.textPrimary};">${paragraphHtml(block.text)}</p>`,
          ),
        );
        text.push(block.text, '');
        break;
      case 'button': {
        if (!isSafeHttpUrl(block.url)) break;
        const href = rewrite(block.url);
        rows.push(
          cell(
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${brand.primary}" style="border-radius:${brand.buttonRadius}px;background-color:${brand.primary};">` +
              `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;font-family:${escapeHtml(brand.fontFamily)};font-size:16px;line-height:20px;font-weight:600;color:${brand.onPrimary};text-decoration:none;border-radius:${brand.buttonRadius}px;">${escapeHtml(block.label)}</a>` +
              `</td></tr></table>`,
            '8px 32px 24px 32px',
          ),
        );
        text.push(`${block.label}: ${block.url}`, '');
        break;
      }
      case 'image': {
        if (!isSafeHttpUrl(block.src)) break;
        const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;">`;
        const linked = block.href && isSafeHttpUrl(block.href) ? `<a href="${escapeHtml(rewrite(block.href))}" target="_blank" rel="noopener">${img}</a>` : img;
        rows.push(cell(linked));
        if (block.alt) text.push(block.alt, '');
        break;
      }
      case 'divider':
        rows.push(cell(`<div style="height:1px;line-height:1px;font-size:1px;background-color:${brand.border};">&nbsp;</div>`, '8px 32px 24px 32px'));
        text.push('----', '');
        break;
      case 'footer':
        rows.push(
          cell(
            `<p style="margin:0;font-family:${escapeHtml(brand.fontFamily)};font-size:13px;line-height:20px;color:${brand.textSecondary};">${paragraphHtml(block.text)}</p>`,
          ),
        );
        text.push(block.text, '');
        break;
    }
  }

  const footerParts: string[] = [escapeHtml(footer.reasonText)];
  const footerText: string[] = [footer.reasonText];
  if (footer.physicalAddress) {
    footerParts.push(`${escapeHtml(brand.studioName)}, ${escapeHtml(footer.physicalAddress)}`);
    footerText.push(`${brand.studioName}, ${footer.physicalAddress}`);
  } else {
    footerParts.push(escapeHtml(brand.studioName));
    footerText.push(brand.studioName);
  }
  if (footer.unsubscribe && isSafeHttpUrl(footer.unsubscribe.url)) {
    footerParts.push(
      `<a href="${escapeHtml(footer.unsubscribe.url)}" target="_blank" rel="noopener" style="color:${brand.textSecondary};text-decoration:underline;">${escapeHtml(footer.unsubscribe.label)}</a>`,
    );
    footerText.push(`${footer.unsubscribe.label}: ${footer.unsubscribe.url}`);
  }

  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.studioName)}" height="40" style="display:block;height:40px;width:auto;border:0;">`
    : `<span style="font-family:${escapeHtml(brand.headingFontFamily)};font-size:20px;line-height:28px;font-weight:700;color:${brand.textPrimary};">${escapeHtml(brand.studioName)}</span>`;

  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>`
    : '';
  const pixel = input.openPixelUrl && isSafeHttpUrl(input.openPixelUrl)
    ? `<img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`
    : '';

  const html =
    `<!DOCTYPE html><html lang="${escapeHtml(input.lang)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">` +
    `<title>${escapeHtml(input.subject)}</title>` +
    `<style>@media only screen and (max-width:620px){.container{width:100% !important;}.px{padding-left:20px !important;padding-right:20px !important;}}</style>` +
    `</head><body style="margin:0;padding:0;background-color:${brand.background};">${preheader}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${brand.background};"><tr><td align="center" style="padding:24px 8px;">` +
    `<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${brand.surface};border:1px solid ${brand.border};border-radius:12px;">` +
    `<tr><td class="px" style="padding:24px 32px 8px 32px;border-top:4px solid ${brand.primary};border-radius:12px 12px 0 0;">${logo}</td></tr>` +
    rows.join('') +
    `<tr><td class="px" style="padding:16px 32px 24px 32px;border-top:1px solid ${brand.border};"><p style="margin:0;font-family:${escapeHtml(brand.fontFamily)};font-size:12px;line-height:18px;color:${brand.textSecondary};">${footerParts.join('<br>')}</p></td></tr>` +
    `</table>${pixel}</td></tr></table></body></html>`;

  const plain = [...text, '--', ...footerText].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { html, text: plain };
}
