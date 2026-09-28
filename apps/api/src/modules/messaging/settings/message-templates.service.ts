import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  BUILTIN_TEMPLATES,
  BUILTIN_TEMPLATE_LOCALES,
  MessagingSettingsSchema,
  TEMPLATE_CHANNELS,
  messagePlaceholders,
  parseMessagingSettings,
} from '@platform/shared';
import type {
  MessageTemplateDTO,
  MessageTemplateListDTO,
  MessagingSettings,
  ResolvedMessagingSettings,
  TemplateChannel,
  TemplateListQuery,
  TenantTemplateUpsertInput,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { pickTemplate, rowToVariant } from '../engine/template-resolver.service';
import type { ResolvedTemplateVariant } from '../engine/template-resolver.service';

function toDto(v: ResolvedTemplateVariant, channel: TemplateChannel, isActive: boolean): MessageTemplateDTO {
  const variables = new Set([...messagePlaceholders(v.body), ...messagePlaceholders(v.subject ?? '')]);
  for (const b of v.blocks ?? []) {
    const texts = b.type === 'button' ? [b.label, b.url] : b.type === 'image' ? [b.alt, b.href ?? ''] : b.type === 'divider' ? [] : [b.text];
    for (const t of texts) for (const name of messagePlaceholders(t)) variables.add(name);
  }
  return {
    id: v.id,
    key: v.key,
    channel,
    locale: v.locale,
    source: v.source,
    body: v.body,
    subject: v.subject,
    blocks: v.blocks,
    whatsappTemplateName: v.whatsappTemplateName,
    whatsappStatus: v.whatsappStatus,
    isTransactional: v.isTransactional,
    isActive,
    variables: [...variables].sort(),
  };
}

/**
 * Tenant side of message templates (Ayarlar > Mesaj şablonları) and the
 * messaging settings. The list shows, for each key x channel x language,
 * the variant the engine would actually send and where it comes from
 * (the tenant's own, the platform default or the built-in default).
 */
@Injectable()
export class MessageTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(studioId: string, query: TemplateListQuery): Promise<MessageTemplateListDTO> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: studioId },
      select: { name: true, logoUrl: true, themeFamily: true, themePrimary: true, gradientPresetKey: true, address: true, defaultLocale: true },
    });
    const rows = await this.prisma.messageTemplate.findMany({
      where: {
        OR: [{ studioId }, { studioId: null }],
        ...(query.key ? { key: query.key } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.locale ? { locale: query.locale } : {}),
      },
    });
    const keys = new Set<string>(query.key ? [query.key] : BUILTIN_TEMPLATES.map((t) => t.key));
    if (!query.key) for (const r of rows) keys.add(r.key);
    const locales = query.locale ? [query.locale] : [...new Set([...BUILTIN_TEMPLATE_LOCALES, studio.defaultLocale])];
    const channels = query.channel ? [query.channel] : TEMPLATE_CHANNELS.filter((c) => c === 'SMS' || c === 'WHATSAPP' || c === 'EMAIL');

    const items: MessageTemplateDTO[] = [];
    for (const key of [...keys].sort()) {
      for (const channel of channels) {
        for (const locale of locales) {
          const candidates = rows.filter((r) => r.key === key && r.channel === channel && r.locale === locale);
          const inactiveTenant = candidates.find((r) => r.studioId === studioId && !r.isActive);
          if (inactiveTenant) {
            items.push(toDto(rowToVariant(inactiveTenant, channel), channel, false));
            continue;
          }
          const variant = pickTemplate(candidates.filter((r) => r.isActive), studioId, key, channel, [locale]);
          if (variant) items.push(toDto(variant, channel, true));
        }
      }
    }
    return {
      items,
      brand: {
        studioName: studio.name,
        logoUrl: studio.logoUrl,
        themeFamily: studio.themeFamily,
        themePrimary: studio.themePrimary,
        gradientPresetKey: studio.gradientPresetKey,
        address: studio.address,
        defaultLocale: studio.defaultLocale,
      },
    };
  }

  async upsert(studioId: string, input: TenantTemplateUpsertInput): Promise<MessageTemplateDTO> {
    const fields = {
      body: input.body,
      subject: input.channel === 'EMAIL' || input.channel === 'PUSH' || input.channel === 'IN_APP' ? (input.subject ?? null) : null,
      blocks: input.channel === 'EMAIL' && input.blocks ? (input.blocks as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      whatsappTemplateName: input.channel === 'WHATSAPP' ? (input.whatsappTemplateName ?? null) : null,
      // A tenant's own WhatsApp template is pending until someone confirms Meta approved it.
      whatsappStatus: input.channel === 'WHATSAPP' ? (input.whatsappStatus ?? 'PENDING') : 'APPROVED',
      isTransactional: input.isTransactional,
      isActive: input.isActive,
    };
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageTemplate.findFirst({
        where: { studioId, key: input.key, channel: input.channel, locale: input.locale },
      });
      if (existing) return tx.messageTemplate.update({ where: { id: existing.id }, data: fields });
      return tx.messageTemplate.create({ data: { studioId, key: input.key, channel: input.channel, locale: input.locale, ...fields } });
    });
    return toDto(rowToVariant(saved, input.channel), input.channel, saved.isActive);
  }

  async remove(studioId: string, id: string): Promise<{ deleted: true }> {
    const removed = await this.prisma.messageTemplate.deleteMany({ where: { id, studioId } });
    if (removed.count === 0) throw new NotFoundException('Şablon bulunamadı');
    return { deleted: true };
  }

  async getSettings(studioId: string): Promise<ResolvedMessagingSettings> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { messagingSettings: true } });
    return parseMessagingSettings(studio.messagingSettings);
  }

  async updateSettings(studioId: string, input: MessagingSettings): Promise<ResolvedMessagingSettings> {
    const current = await this.prisma.studio.findUnique({ where: { id: studioId }, select: { messagingSettings: true } });
    if (!current) throw new NotFoundException('İşletme bulunamadı');
    const parsed = MessagingSettingsSchema.safeParse(current.messagingSettings ?? {});
    const merged: MessagingSettings = { ...(parsed.success ? parsed.data : {}), ...input };
    await this.prisma.studio.update({ where: { id: studioId }, data: { messagingSettings: merged as Prisma.InputJsonValue } });
    return parseMessagingSettings(merged);
  }
}
