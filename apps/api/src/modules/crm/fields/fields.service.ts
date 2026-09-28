import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import type { ContactFieldDefinition } from '@platform/database';
import type { CreateContactFieldInput, UpdateContactFieldInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface ContactFieldDTO {
  id: string;
  key: string;
  label: Record<string, string>;
  kind: string;
  options: string[];
  sortOrder: number;
  isArchived: boolean;
}

/** Tenant custom contact fields (ContactFieldDefinition). */
@Injectable()
export class FieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(studioId: string, includeArchived: boolean): Promise<ContactFieldDTO[]> {
    const defs = await this.prisma.contactFieldDefinition.findMany({
      where: { studioId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    return defs.map(toDto);
  }

  async create(studioId: string, dto: CreateContactFieldInput): Promise<ContactFieldDTO> {
    try {
      const def = await this.prisma.contactFieldDefinition.create({
        data: {
          studioId,
          key: dto.key,
          label: dto.label as Prisma.InputJsonValue,
          kind: dto.kind,
          options: dto.kind === 'enum' ? dto.options ?? [] : [],
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return toDto(def);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bu anahtarla bir alan zaten var');
      }
      throw err;
    }
  }

  async update(studioId: string, fieldId: string, dto: UpdateContactFieldInput): Promise<ContactFieldDTO> {
    const def = await this.getOwn(studioId, fieldId);
    if (dto.options !== undefined && def.kind !== 'enum') {
      throw new BadRequestException('Seçenekler yalnızca seçim listesi alanlarında kullanılır');
    }
    const updated = await this.prisma.contactFieldDefinition.update({
      where: { id: def.id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label as Prisma.InputJsonValue } : {}),
        ...(dto.options !== undefined ? { options: dto.options } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });
    return toDto(updated);
  }

  /** Deletes the definition; stored values stay in contacts' customFields but are no longer shown or editable. */
  async remove(studioId: string, fieldId: string): Promise<{ deleted: true }> {
    const def = await this.getOwn(studioId, fieldId);
    await this.prisma.contactFieldDefinition.delete({ where: { id: def.id } });
    return { deleted: true };
  }

  private async getOwn(studioId: string, fieldId: string): Promise<ContactFieldDefinition> {
    const def = await this.prisma.contactFieldDefinition.findFirst({ where: { id: fieldId, studioId } });
    if (!def) throw new NotFoundException('Alan bulunamadı');
    return def;
  }
}

function toDto(d: ContactFieldDefinition): ContactFieldDTO {
  return {
    id: d.id,
    key: d.key,
    label: (d.label ?? {}) as Record<string, string>,
    kind: d.kind,
    options: d.options,
    sortOrder: d.sortOrder,
    isArchived: d.isArchived,
  };
}
