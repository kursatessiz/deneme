import { Injectable } from '@nestjs/common';
import type { AdminUpsertMessageTemplateInput, PublishDocumentVersionInput } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listMessageTemplates(studioId?: string | null) {
    return this.prisma.messageTemplate.findMany({
      where: studioId === undefined ? {} : { studioId },
      orderBy: [{ key: 'asc' }, { channel: 'asc' }],
    });
  }

  async upsertMessageTemplate(actorUserId: string, input: AdminUpsertMessageTemplateInput) {
    // studioId is nullable and part of the compound unique key (NULLS NOT
    // DISTINCT at the database); Prisma's generated upsert/findUnique typing
    // does not accept null there, so this reads and writes via
    // findFirst/create/update instead (see FeatureFlagsService for the same
    // pattern).
    const template = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageTemplate.findFirst({
        where: { studioId: input.studioId, key: input.key, channel: input.channel, locale: input.locale },
      });
      const fields = {
        body: input.body,
        whatsappTemplateName: input.whatsappTemplateName ?? null,
        isTransactional: input.isTransactional,
        isActive: input.isActive,
      };
      if (existing) {
        return tx.messageTemplate.update({ where: { id: existing.id }, data: fields });
      }
      return tx.messageTemplate.create({
        data: { studioId: input.studioId, key: input.key, channel: input.channel, locale: input.locale, ...fields },
      });
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: input.studioId,
        userId: actorUserId,
        action: 'message_template.upsert',
        entityType: 'MessageTemplate',
        entityId: template.id,
        metadata: { key: input.key, channel: input.channel, locale: input.locale, global: input.studioId === null },
      },
    });
    return template;
  }

  async listDocumentVersions(studioId?: string | null) {
    return this.prisma.documentVersion.findMany({
      where: studioId === undefined ? {} : { studioId },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });
  }

  /** Publishes the next version for (studioId, type); versions are append-only, never edited in place. */
  async publishDocumentVersion(actorUserId: string, input: PublishDocumentVersionInput) {
    const latest = await this.prisma.documentVersion.findFirst({
      where: { studioId: input.studioId, type: input.type },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;

    const doc = await this.prisma.documentVersion.create({
      data: {
        studioId: input.studioId,
        type: input.type,
        version,
        title: input.title,
        body: input.body,
        publishedAt: new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        studioId: input.studioId,
        userId: actorUserId,
        action: 'document_version.publish',
        entityType: 'DocumentVersion',
        entityId: doc.id,
        metadata: { type: input.type, version, global: input.studioId === null },
      },
    });
    return doc;
  }
}
