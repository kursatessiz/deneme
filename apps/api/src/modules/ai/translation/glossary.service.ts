import { Injectable, NotFoundException } from '@nestjs/common';
import type { GlossaryTermDTO, GlossaryTermInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

type GlossaryRow = { id: string; locale: string; term: string; translation: string | null; note: string | null; updatedAt: Date };

function toDTO(row: GlossaryRow): GlossaryTermDTO {
  return { id: row.id, locale: row.locale, term: row.term, translation: row.translation, note: row.note, updatedAt: row.updatedAt.toISOString() };
}

/** Per-language glossary the translation prompt must follow (super-admin editable). */
@Injectable()
export class GlossaryService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertLanguage(locale: string): Promise<void> {
    const language = await this.prisma.language.findUnique({ where: { code: locale } });
    if (!language) throw new NotFoundException(`"${locale}" dili bulunamadı.`);
  }

  async list(locale: string): Promise<GlossaryTermDTO[]> {
    await this.assertLanguage(locale);
    const rows = await this.prisma.aiGlossaryTerm.findMany({ where: { locale }, orderBy: { term: 'asc' } });
    return rows.map(toDTO);
  }

  /** Same term twice replaces the earlier rule. */
  async upsert(actorUserId: string, locale: string, input: GlossaryTermInput): Promise<GlossaryTermDTO> {
    await this.assertLanguage(locale);
    const data = { translation: input.translation, note: input.note ?? null };
    const row = await this.prisma.aiGlossaryTerm.upsert({
      where: { locale_term: { locale, term: input.term } },
      create: { locale, term: input.term, ...data },
      update: data,
    });
    await this.prisma.auditLog.create({
      data: { userId: actorUserId, action: 'ai.glossary.upsert', entityType: 'AiGlossaryTerm', entityId: row.id, metadata: { locale, term: input.term } },
    });
    return toDTO(row);
  }

  async remove(actorUserId: string, locale: string, id: string): Promise<void> {
    const deleted = await this.prisma.aiGlossaryTerm.deleteMany({ where: { id, locale } });
    if (deleted.count === 0) throw new NotFoundException('Terim bulunamadı.');
    await this.prisma.auditLog.create({
      data: { userId: actorUserId, action: 'ai.glossary.delete', entityType: 'AiGlossaryTerm', entityId: id, metadata: { locale } },
    });
  }
}
