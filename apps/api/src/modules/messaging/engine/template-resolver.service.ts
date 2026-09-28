import { Injectable } from '@nestjs/common';
import type { MessageTemplate } from '@platform/database';
import { BASE_LOCALE, EmailBlocksSchema, builtinTemplateContent, WHATSAPP_TEMPLATE_STATUSES } from '@platform/shared';
import type { EmailBlock, TemplateChannel, TemplateContent, TemplateSource, WhatsappTemplateStatus } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedTemplateVariant extends TemplateContent {
  id: string | null;
  key: string;
  source: TemplateSource;
  locale: string;
  whatsappStatus: WhatsappTemplateStatus | null;
}

type TemplateRow = Pick<
  MessageTemplate,
  'id' | 'studioId' | 'key' | 'locale' | 'body' | 'subject' | 'blocks' | 'whatsappTemplateName' | 'whatsappStatus' | 'isTransactional'
>;

/**
 * Locale fallback order (docs/MESAJLASMA.md): the requested language, its
 * base language (pt-BR -> pt), the studio's default language, then Turkish.
 */
export function localeChain(requested: string | null | undefined, studioDefault: string | null | undefined): string[] {
  const chain: string[] = [];
  const push = (l: string | null | undefined) => {
    if (l && !chain.includes(l)) chain.push(l);
  };
  push(requested);
  if (requested && requested.includes('-')) push(requested.split('-')[0]);
  push(studioDefault);
  push(BASE_LOCALE);
  return chain;
}

function parseBlocks(raw: unknown): EmailBlock[] | null {
  if (raw === null || raw === undefined) return null;
  const parsed = EmailBlocksSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseStatus(raw: string | null | undefined): WhatsappTemplateStatus {
  return (WHATSAPP_TEMPLATE_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as WhatsappTemplateStatus) : 'PENDING';
}

export function rowToVariant(row: TemplateRow, channel: TemplateChannel): ResolvedTemplateVariant {
  return {
    id: row.id,
    key: row.key,
    source: row.studioId ? 'TENANT' : 'GLOBAL',
    locale: row.locale,
    body: row.body,
    subject: row.subject ?? null,
    blocks: channel === 'EMAIL' ? parseBlocks(row.blocks) : null,
    whatsappTemplateName: row.whatsappTemplateName ?? null,
    whatsappStatus: channel === 'WHATSAPP' ? parseStatus(row.whatsappStatus) : null,
    isTransactional: row.isTransactional,
  };
}

/**
 * For each locale in order: the tenant's override, then the global default
 * (super admin), then the built-in default shipped in the i18n catalogue.
 * A tenant override in Turkish therefore does not shadow the English
 * default for an English-speaking recipient; the recipient's language wins.
 */
export function pickTemplate(
  rows: readonly TemplateRow[],
  studioId: string | null,
  key: string,
  channel: TemplateChannel,
  locales: readonly string[],
): ResolvedTemplateVariant | null {
  for (const locale of locales) {
    const tenant = studioId ? rows.find((r) => r.studioId === studioId && r.locale === locale) : undefined;
    if (tenant) return rowToVariant(tenant, channel);
    const global = rows.find((r) => r.studioId === null && r.locale === locale);
    if (global) return rowToVariant(global, channel);
    const builtin = builtinTemplateContent(key, channel, locale);
    if (builtin) {
      return {
        ...builtin,
        id: null,
        key,
        source: 'BUILTIN',
        locale,
        whatsappStatus: channel === 'WHATSAPP' ? 'APPROVED' : null,
      };
    }
  }
  return null;
}

@Injectable()
export class TemplateResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    studioId: string | null,
    key: string,
    channel: TemplateChannel,
    locales: readonly string[],
  ): Promise<ResolvedTemplateVariant | null> {
    const rows = await this.prisma.messageTemplate.findMany({
      where: {
        key,
        channel,
        locale: { in: [...locales] },
        isActive: true,
        OR: studioId ? [{ studioId }, { studioId: null }] : [{ studioId: null }],
      },
    });
    return pickTemplate(rows, studioId, key, channel, locales);
  }

  /** A specific row: the studio's own or a global one, never another tenant's. */
  async resolveById(studioId: string | null, id: string, channel: TemplateChannel): Promise<ResolvedTemplateVariant | null> {
    const row = await this.prisma.messageTemplate.findFirst({
      where: { id, channel, isActive: true, OR: studioId ? [{ studioId }, { studioId: null }] : [{ studioId: null }] },
    });
    return row ? rowToVariant(row, channel) : null;
  }

  /** Whether the key (in any channel/locale) is marked non-transactional for this studio. */
  async isCommercialKey(studioId: string | null, key: string): Promise<boolean> {
    const row = await this.prisma.messageTemplate.findFirst({
      where: { key, isTransactional: false, isActive: true, OR: studioId ? [{ studioId }, { studioId: null }] : [{ studioId: null }] },
      select: { id: true },
    });
    if (row) return true;
    return builtinTemplateContent(key, 'SMS', BASE_LOCALE)?.isTransactional === false;
  }
}
