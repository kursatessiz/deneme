import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationChannel } from '@platform/database';
import { renderTemplate } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedTemplate {
  body: string;
  whatsappTemplateName: string | null;
  isTransactional: boolean;
}

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A tenant override (studioId = the tenant) takes priority over the
   * global default (studioId = null) for the same key/channel/locale.
   */
  async resolve(
    studioId: string | null,
    key: string,
    channel: NotificationChannel,
    locale = 'tr',
  ): Promise<ResolvedTemplate> {
    const [tenantTemplate, globalTemplate] = await Promise.all([
      studioId
        ? this.prisma.messageTemplate.findFirst({ where: { studioId, key, channel, locale, isActive: true } })
        : Promise.resolve(null),
      this.prisma.messageTemplate.findFirst({ where: { studioId: null, key, channel, locale, isActive: true } }),
    ]);
    const template = tenantTemplate ?? globalTemplate;
    if (!template) {
      throw new NotFoundException(`"${key}" (${channel}/${locale}) için şablon bulunamadı`);
    }
    return {
      body: template.body,
      whatsappTemplateName: template.whatsappTemplateName,
      isTransactional: template.isTransactional,
    };
  }

  /** Renders and throws when a required placeholder is missing. */
  render(body: string, params: Record<string, string>): string {
    return renderTemplate(body, params);
  }
}
