import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  BASE_LOCALE,
  BASE_MESSAGES,
  BUNDLED_LANGUAGES,
  BUNDLED_MESSAGES,
  buildLanguagePack,
  LanguagePackError,
  packCompletion,
  packToCsv,
  parseCsvPack,
  parseJsonPack,
  placeholdersOf,
  validatePackMessages,
  type AdminLanguageDTO,
  type CreateLanguageInput,
  type ImportLanguagePackInput,
  type ImportReportDTO,
  type LanguageDTO,
  type LocaleMessagesDTO,
  type PublicLanguagesDTO,
  type TranslationEntriesQuery,
  type TranslationEntryDTO,
  type UpdateLanguageInput,
} from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';

const bundledCodes = new Set<string>(BUNDLED_LANGUAGES.map((l) => l.code));

/** Own-property check without Object.hasOwn (matches packages/shared/src/i18n/own.ts). */
function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Short, stable content fingerprint used as both `version` and the ETag. */
function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

@Injectable()
export class I18nService implements OnModuleInit {
  /**
   * Per-locale computed message cache. This holds process memory only: it
   * is correct as long as a single API instance serves writes (per
   * CLAUDE.md's production topology). A multi-instance deployment would
   * need a shared invalidation signal (e.g. a Redis pub/sub bump) to keep
   * every instance's cache in step; out of scope while there is one instance.
   */
  private readonly cache = new Map<string, LocaleMessagesDTO>();

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: creates missing bundled language rows, never flips isEnabled on an existing row. */
  async onModuleInit(): Promise<void> {
    await this.ensureBundledLanguages();
  }

  async ensureBundledLanguages(): Promise<void> {
    for (const lang of BUNDLED_LANGUAGES) {
      const existing = await this.prisma.language.findUnique({ where: { code: lang.code } });
      if (!existing) {
        await this.prisma.language.create({
          data: { code: lang.code, name: lang.name, nativeName: lang.nativeName, isEnabled: true },
        });
      } else if (existing.name !== lang.name || existing.nativeName !== lang.nativeName) {
        await this.prisma.language.update({
          where: { code: lang.code },
          data: { name: lang.name, nativeName: lang.nativeName },
        });
      }
    }
  }

  private invalidate(locale?: string): void {
    if (locale) this.cache.delete(locale);
    else this.cache.clear();
  }

  // -- public ---------------------------------------------------------

  async getPublicLanguages(): Promise<PublicLanguagesDTO> {
    const rows = await this.prisma.language.findMany({
      where: { isEnabled: true },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, nativeName: true },
    });
    const items = [...rows].sort((a, b) => {
      if (a.code === BASE_LOCALE) return -1;
      if (b.code === BASE_LOCALE) return 1;
      return a.code.localeCompare(b.code);
    });
    return { baseLocale: BASE_LOCALE, items };
  }

  /** Bundled messages merged with overrides for one enabled locale, cached in memory. Null for unknown/disabled locales. */
  async getLocaleMessages(locale: string): Promise<LocaleMessagesDTO | null> {
    const cached = this.cache.get(locale);
    if (cached) return cached;

    const language = await this.prisma.language.findUnique({ where: { code: locale } });
    if (!language || !language.isEnabled) return null;

    const messages = await this.computeEffectiveMessages(locale);
    const version = shortHash(JSON.stringify(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b))));
    const dto: LocaleMessagesDTO = { locale, version, messages };
    this.cache.set(locale, dto);
    return dto;
  }

  /** Bundled values for `locale`, overlaid with overrides; only keys still present in BASE_MESSAGES. */
  private async computeEffectiveMessages(locale: string): Promise<Record<string, string>> {
    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[locale] ?? {};
    const overrides = await this.prisma.translationOverride.findMany({ where: { locale } });
    const messages: Record<string, string> = {};
    for (const key of Object.keys(BASE_MESSAGES)) {
      if (hasOwn(bundled, key)) messages[key] = bundled[key];
    }
    for (const o of overrides) {
      if (hasOwn(BASE_MESSAGES, o.key)) messages[o.key] = o.value;
    }
    return messages;
  }

  // -- admin ------------------------------------------------------------

  async adminListLanguages(): Promise<AdminLanguageDTO[]> {
    const rows = await this.prisma.language.findMany({ orderBy: { code: 'asc' } });
    const result: AdminLanguageDTO[] = [];
    for (const row of rows) {
      const messages = await this.computeEffectiveMessages(row.code);
      const { completion, translatedKeys, totalKeys } = packCompletion(messages, BASE_MESSAGES);
      result.push({
        code: row.code,
        name: row.name,
        nativeName: row.nativeName,
        isEnabled: row.isEnabled,
        isBase: row.code === BASE_LOCALE,
        isBundled: bundledCodes.has(row.code),
        completion,
        translatedKeys,
        totalKeys,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    return result.sort((a, b) => (a.code === BASE_LOCALE ? -1 : b.code === BASE_LOCALE ? 1 : a.code.localeCompare(b.code)));
  }

  async adminCreateLanguage(actorUserId: string, input: CreateLanguageInput): Promise<AdminLanguageDTO> {
    const existing = await this.prisma.language.findUnique({ where: { code: input.code } });
    if (existing) throw new ConflictException('Bu dil kodu zaten tanımlı.');
    const row = await this.prisma.language.create({
      data: { code: input.code, name: input.name, nativeName: input.nativeName, isEnabled: false },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'i18n.language.create',
        entityType: 'Language',
        entityId: row.code,
        metadata: { code: row.code, name: row.name, nativeName: row.nativeName },
      },
    });
    return this.toAdminLanguageDTO(row);
  }

  async adminUpdateLanguage(actorUserId: string, code: string, input: UpdateLanguageInput): Promise<AdminLanguageDTO> {
    const existing = await this.getLanguageOrThrow(code);
    if (code === BASE_LOCALE && input.isEnabled === false) {
      throw new BadRequestException('Temel dil (Türkçe) devre dışı bırakılamaz.');
    }
    const row = await this.prisma.language.update({
      where: { code },
      data: {
        name: input.name ?? undefined,
        nativeName: input.nativeName ?? undefined,
        isEnabled: input.isEnabled ?? undefined,
      },
    });
    this.invalidate(code);
    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'i18n.language.update',
        entityType: 'Language',
        entityId: row.code,
        metadata: { before: existing, after: input },
      },
    });
    return this.toAdminLanguageDTO(row);
  }

  async adminDeleteLanguage(actorUserId: string, code: string): Promise<void> {
    const existing = await this.getLanguageOrThrow(code);
    if (bundledCodes.has(code)) {
      throw new BadRequestException('Yerleşik diller (tr, en) silinemez.');
    }
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { locale: code }, data: { locale: null } }),
      this.prisma.studio.updateMany({ where: { defaultLocale: code }, data: { defaultLocale: BASE_LOCALE } }),
      this.prisma.language.delete({ where: { code } }),
      this.prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'i18n.language.delete',
          entityType: 'Language',
          entityId: code,
          metadata: { deleted: existing },
        },
      }),
    ]);
    this.invalidate(code);
  }

  async adminListEntries(code: string, query: TranslationEntriesQuery): Promise<TranslationEntryDTO[]> {
    await this.getLanguageOrThrow(code);
    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[code] ?? {};
    const overrides = await this.prisma.translationOverride.findMany({ where: { locale: code } });
    const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));

    const q = query.q?.toLowerCase();
    const namespace = query.namespace;
    const entries: TranslationEntryDTO[] = [];
    for (const key of Object.keys(BASE_MESSAGES).sort()) {
      if (namespace && key !== namespace && !key.startsWith(`${namespace}.`)) continue;
      const base = (BASE_MESSAGES as Record<string, string>)[key];
      const bundledValue = hasOwn(bundled, key) ? bundled[key] : null;
      const overrideValue = overrideMap.has(key) ? overrideMap.get(key)! : null;
      const effective = overrideValue ?? bundledValue;
      if (query.missingOnly && effective !== null) continue;
      if (q && !key.toLowerCase().includes(q) && !base.toLowerCase().includes(q) && !(effective ?? '').toLowerCase().includes(q)) {
        continue;
      }
      entries.push({
        key,
        base,
        bundled: bundledValue,
        override: overrideValue,
        effective,
        placeholders: placeholdersOf(base),
      });
    }
    return entries;
  }

  /** `value: null` (or blank) removes the override; a value equal to the bundled one is not stored either. */
  async adminUpsertEntry(actorUserId: string, code: string, key: string, value: string | null): Promise<TranslationEntryDTO> {
    await this.getLanguageOrThrow(code);
    const base = (BASE_MESSAGES as Record<string, string>)[key];
    if (base === undefined) throw new BadRequestException(`"${key}" geçerli bir mesaj anahtarı değil.`);

    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[code] ?? {};
    const bundledValue = hasOwn(bundled, key) ? bundled[key] : null;
    const trimmed = value === null || value.trim() === '' ? null : value;

    if (trimmed !== null) {
      const expected = placeholdersOf(base);
      const actual = placeholdersOf(trimmed);
      if (expected.join(',') !== actual.join(',')) {
        throw new BadRequestException(`"${key}" için yer tutucular kaynak metinle uyuşmuyor: beklenen ${expected.join(', ') || '(yok)'}.`);
      }
    }

    const redundant = trimmed !== null && bundledValue !== null && trimmed === bundledValue;
    if (trimmed === null || redundant) {
      await this.prisma.translationOverride.deleteMany({ where: { locale: code, key } });
    } else {
      await this.prisma.translationOverride.upsert({
        where: { locale_key: { locale: code, key } },
        create: { locale: code, key, value: trimmed, updatedByUserId: actorUserId },
        update: { value: trimmed, updatedByUserId: actorUserId },
      });
    }
    this.invalidate(code);
    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'i18n.translation.upsert',
        entityType: 'TranslationOverride',
        entityId: `${code}:${key}`,
        metadata: { locale: code, key, value: trimmed },
      },
    });

    const overrideRow = await this.prisma.translationOverride.findUnique({ where: { locale_key: { locale: code, key } } });
    const override = overrideRow?.value ?? null;
    return { key, base, bundled: bundledValue, override, effective: override ?? bundledValue, placeholders: placeholdersOf(base) };
  }

  async adminExport(code: string): Promise<{ locale: string; name: string; nativeName: string; messages: Record<string, string> }> {
    const language = await this.getLanguageOrThrow(code);
    const messages = await this.computeEffectiveMessages(code);
    return { locale: code, name: language.name, nativeName: language.nativeName, messages };
  }

  buildPackJson(code: string, name: string, nativeName: string, messages: Record<string, string>): string {
    const pack = buildLanguagePack({ locale: code, name, nativeName, messages, base: BASE_MESSAGES });
    return JSON.stringify(pack, null, 2);
  }

  buildPackCsv(code: string, name: string, nativeName: string, messages: Record<string, string>): string {
    const pack = buildLanguagePack({ locale: code, name, nativeName, messages, base: BASE_MESSAGES });
    return packToCsv(pack, BASE_MESSAGES);
  }

  async adminImport(actorUserId: string, code: string, input: ImportLanguagePackInput): Promise<ImportReportDTO> {
    await this.getLanguageOrThrow(code);

    let uploaded: Record<string, string>;
    try {
      uploaded = input.format === 'json' ? parseJsonPack(input.content, code).messages : parseCsvPack(input.content);
    } catch (err) {
      if (err instanceof LanguagePackError) throw new BadRequestException(err.message);
      throw err;
    }

    const { accepted, unknownKeys, emptyKeys, placeholderMismatches } = validatePackMessages(uploaded, BASE_MESSAGES);

    const report: ImportReportDTO = {
      locale: code,
      dryRun: input.dryRun,
      applied: placeholderMismatches.length === 0,
      acceptedCount: Object.keys(accepted).length,
      changedCount: 0,
      removedCount: 0,
      unknownKeys,
      emptyKeys,
      placeholderMismatches,
    };

    if (placeholderMismatches.length > 0 || input.dryRun) {
      // Still report how many rows would change, without writing anything.
      if (placeholderMismatches.length === 0) {
        const { changed, removed } = await this.diffOnly(code, accepted, input.mode);
        report.changedCount = changed;
        report.removedCount = removed;
      }
      return report;
    }

    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[code] ?? {};
    const existingOverrides = await this.prisma.translationOverride.findMany({ where: { locale: code } });
    const existingMap = new Map(existingOverrides.map((o) => [o.key, o.value]));

    let changed = 0;
    let removed = 0;
    const writes: Promise<unknown>[] = [];
    const acceptedKeys = new Set(Object.keys(accepted));

    for (const [key, value] of Object.entries(accepted)) {
      const bundledValue = hasOwn(bundled, key) ? bundled[key] : null;
      const redundant = bundledValue !== null && value === bundledValue;
      const hadOverride = existingMap.has(key);
      if (redundant) {
        if (hadOverride) {
          writes.push(this.prisma.translationOverride.delete({ where: { locale_key: { locale: code, key } } }));
          changed++;
          removed++;
        }
        continue;
      }
      if (!hadOverride || existingMap.get(key) !== value) {
        writes.push(
          this.prisma.translationOverride.upsert({
            where: { locale_key: { locale: code, key } },
            create: { locale: code, key, value, updatedByUserId: actorUserId },
            update: { value, updatedByUserId: actorUserId },
          }),
        );
        changed++;
      }
    }

    if (input.mode === 'replace') {
      for (const existing of existingOverrides) {
        if (!acceptedKeys.has(existing.key)) {
          writes.push(this.prisma.translationOverride.delete({ where: { id: existing.id } }));
          removed++;
        }
      }
    }

    if (writes.length > 0) await this.prisma.$transaction(writes as never[]);
    this.invalidate(code);

    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'i18n.language.import',
        entityType: 'Language',
        entityId: code,
        metadata: { mode: input.mode, format: input.format, acceptedCount: report.acceptedCount, changed, removed },
      },
    });

    report.changedCount = changed;
    report.removedCount = removed;
    return report;
  }

  /** Computes what an import would change without writing, for dryRun. */
  private async diffOnly(code: string, accepted: Record<string, string>, mode: 'merge' | 'replace'): Promise<{ changed: number; removed: number }> {
    const bundled: Readonly<Record<string, string>> = BUNDLED_MESSAGES[code] ?? {};
    const existingOverrides = await this.prisma.translationOverride.findMany({ where: { locale: code } });
    const existingMap = new Map(existingOverrides.map((o) => [o.key, o.value]));
    const acceptedKeys = new Set(Object.keys(accepted));
    let changed = 0;
    let removed = 0;
    for (const [key, value] of Object.entries(accepted)) {
      const bundledValue = hasOwn(bundled, key) ? bundled[key] : null;
      const redundant = bundledValue !== null && value === bundledValue;
      const hadOverride = existingMap.has(key);
      if (redundant) {
        if (hadOverride) {
          changed++;
          removed++;
        }
        continue;
      }
      if (!hadOverride || existingMap.get(key) !== value) changed++;
    }
    if (mode === 'replace') {
      for (const existing of existingOverrides) {
        if (!acceptedKeys.has(existing.key)) removed++;
      }
    }
    return { changed, removed };
  }

  // -- shared helpers -----------------------------------------------------

  private async getLanguageOrThrow(code: string) {
    const language = await this.prisma.language.findUnique({ where: { code } });
    if (!language) throw new NotFoundException(`"${code}" dili bulunamadı.`);
    return language;
  }

  private toAdminLanguageDTO(row: { code: string; name: string; nativeName: string; isEnabled: boolean; updatedAt: Date }): AdminLanguageDTO {
    return {
      code: row.code,
      name: row.name,
      nativeName: row.nativeName,
      isEnabled: row.isEnabled,
      isBase: row.code === BASE_LOCALE,
      isBundled: bundledCodes.has(row.code),
      completion: row.code === BASE_LOCALE ? 1 : 0,
      translatedKeys: 0,
      totalKeys: Object.keys(BASE_MESSAGES).length,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Whether `code` is an enabled language (used by /me/locale and /studios/:id/locale). */
  async isEnabledLocale(code: string): Promise<boolean> {
    const row = await this.prisma.language.findUnique({ where: { code } });
    return Boolean(row?.isEnabled);
  }

  async listLanguageDTOs(): Promise<LanguageDTO[]> {
    const rows = await this.prisma.language.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      nativeName: r.nativeName,
      isEnabled: r.isEnabled,
      isBase: r.code === BASE_LOCALE,
      isBundled: bundledCodes.has(r.code),
    }));
  }
}
