import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from './i18n.service';

function makePrisma() {
  return {
    language: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    translationOverride: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
    },
    user: { updateMany: jest.fn() },
    studio: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[] | ((tx: unknown) => unknown)) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops({});
    }),
  };
}

describe('I18nService', () => {
  it('getPublicLanguages returns only enabled languages with tr first', async () => {
    const prisma = makePrisma();
    prisma.language.findMany.mockResolvedValue([
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
    ]);
    const service = new I18nService(prisma as never);
    const result = await service.getPublicLanguages();
    expect(result.baseLocale).toBe('tr');
    expect(result.items[0].code).toBe('tr');
  });

  it('getLocaleMessages returns null for a disabled locale', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'de', isEnabled: false });
    const service = new I18nService(prisma as never);
    await expect(service.getLocaleMessages('de')).resolves.toBeNull();
  });

  it('getLocaleMessages merges bundled messages with overrides and caches the result', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true });
    prisma.translationOverride.findMany.mockResolvedValue([{ locale: 'en', key: 'common.save', value: 'Save changes' }]);

    const service = new I18nService(prisma as never);
    const first = await service.getLocaleMessages('en');
    expect(first?.messages['common.save']).toBe('Save changes');
    expect(first?.messages['common.cancel']).toBe('Cancel');
    expect(first?.version).toEqual(expect.any(String));

    // Second call must hit the in-memory cache, not the database again.
    prisma.translationOverride.findMany.mockClear();
    const second = await service.getLocaleMessages('en');
    expect(second?.version).toBe(first?.version);
    expect(prisma.translationOverride.findMany).not.toHaveBeenCalled();
  });

  it('adminUpdateLanguage refuses to disable the base language', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'tr', isEnabled: true, name: 'Turkish', nativeName: 'Türkçe' });
    const service = new I18nService(prisma as never);
    await expect(service.adminUpdateLanguage('actor', 'tr', { isEnabled: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adminDeleteLanguage refuses to delete a bundled language', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
    const service = new I18nService(prisma as never);
    await expect(service.adminDeleteLanguage('actor', 'en')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adminDeleteLanguage resets users and studios pointed at the deleted language', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'de', isEnabled: true, name: 'German', nativeName: 'Deutsch' });
    const service = new I18nService(prisma as never);
    await service.adminDeleteLanguage('actor', 'de');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { locale: 'de' }, data: { locale: null } });
    expect(prisma.studio.updateMany).toHaveBeenCalledWith({ where: { defaultLocale: 'de' }, data: { defaultLocale: 'tr' } });
    expect(prisma.language.delete).toHaveBeenCalledWith({ where: { code: 'de' } });
  });

  it('adminUpsertEntry rejects an unknown key', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
    const service = new I18nService(prisma as never);
    await expect(service.adminUpsertEntry('actor', 'en', 'not.a.real.key', 'value')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adminUpsertEntry rejects a value whose placeholders differ from the source', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
    const service = new I18nService(prisma as never);
    await expect(service.adminUpsertEntry('actor', 'en', 'common.itemCount.one', 'no placeholder here')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('adminUpsertEntry deletes the override when the value equals the bundled value', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
    prisma.translationOverride.findUnique.mockResolvedValue(null);
    const service = new I18nService(prisma as never);
    await service.adminUpsertEntry('actor', 'en', 'common.save', 'Save');
    expect(prisma.translationOverride.deleteMany).toHaveBeenCalledWith({ where: { locale: 'en', key: 'common.save' } });
    expect(prisma.translationOverride.upsert).not.toHaveBeenCalled();
  });

  it('adminUpsertEntry stores a genuinely different value', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
    prisma.translationOverride.findUnique.mockResolvedValue({ value: 'Save changes' });
    const service = new I18nService(prisma as never);
    await service.adminUpsertEntry('actor', 'en', 'common.save', 'Save changes');
    expect(prisma.translationOverride.upsert).toHaveBeenCalled();
  });

  it('getLanguageOrThrow behaviour surfaces as 404 through adminListEntries', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue(null);
    const service = new I18nService(prisma as never);
    await expect(service.adminListEntries('xx', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('isEnabledLocale reflects the language row', async () => {
    const prisma = makePrisma();
    prisma.language.findUnique.mockResolvedValue({ isEnabled: true });
    const service = new I18nService(prisma as never);
    await expect(service.isEnabledLocale('en')).resolves.toBe(true);
  });

  describe('adminImport', () => {
    it('writes nothing and reports applied:false on a placeholder mismatch', async () => {
      const prisma = makePrisma();
      prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
      prisma.translationOverride.findMany.mockResolvedValue([]);
      const service = new I18nService(prisma as never);
      const content = JSON.stringify({
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.itemCount.one': 'no placeholder' },
      });
      const report = await service.adminImport('actor', 'en', { format: 'json', content, dryRun: false, mode: 'merge' });
      expect(report.applied).toBe(false);
      expect(report.placeholderMismatches).toHaveLength(1);
      expect(prisma.translationOverride.upsert).not.toHaveBeenCalled();
    });

    it('dryRun writes nothing', async () => {
      const prisma = makePrisma();
      prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
      prisma.translationOverride.findMany.mockResolvedValue([]);
      const service = new I18nService(prisma as never);
      const content = JSON.stringify({
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.save': 'Store' },
      });
      const report = await service.adminImport('actor', 'en', { format: 'json', content, dryRun: true, mode: 'merge' });
      expect(report.dryRun).toBe(true);
      expect(report.applied).toBe(true);
      expect(prisma.translationOverride.upsert).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('replace mode removes overrides for keys missing from the upload', async () => {
      const prisma = makePrisma();
      prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
      prisma.translationOverride.findMany.mockResolvedValue([{ id: 'row-1', locale: 'en', key: 'common.cancel', value: 'Abort' }]);
      const service = new I18nService(prisma as never);
      const content = JSON.stringify({
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.save': 'Store' },
      });
      const report = await service.adminImport('actor', 'en', { format: 'json', content, dryRun: false, mode: 'replace' });
      expect(report.applied).toBe(true);
      expect(report.removedCount).toBe(1);
      expect(prisma.translationOverride.delete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
    });

    it('merge mode keeps overrides for keys missing from the upload', async () => {
      const prisma = makePrisma();
      prisma.language.findUnique.mockResolvedValue({ code: 'en', isEnabled: true, name: 'English', nativeName: 'English' });
      prisma.translationOverride.findMany.mockResolvedValue([{ id: 'row-1', locale: 'en', key: 'common.cancel', value: 'Abort' }]);
      const service = new I18nService(prisma as never);
      const content = JSON.stringify({
        format: 'platform.language-pack',
        formatVersion: 1,
        locale: 'en',
        baseLocale: 'tr',
        messages: { 'common.save': 'Store' },
      });
      const report = await service.adminImport('actor', 'en', { format: 'json', content, dryRun: false, mode: 'merge' });
      expect(report.applied).toBe(true);
      expect(report.removedCount).toBe(0);
      expect(prisma.translationOverride.delete).not.toHaveBeenCalled();
    });
  });
});
