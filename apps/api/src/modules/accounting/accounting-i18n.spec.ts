import { BUNDLED_MESSAGES } from '@platform/shared';
import type { LocaleMessagesDTO } from '@platform/shared';
import { exportTranslator } from './accounting-i18n';

function i18nWith(effective: Record<string, Record<string, string>>) {
  return {
    getLocaleMessages: jest.fn(async (locale: string): Promise<LocaleMessagesDTO | null> =>
      effective[locale] ? { locale, version: 'v', messages: effective[locale] } : null,
    ),
  };
}

describe('exportTranslator', () => {
  it('uses an override (CMS or uploaded pack) of the requested locale for the header', async () => {
    const i18n = i18nWith({ en: { ...BUNDLED_MESSAGES.en, 'accounting.col.date': 'Booking date' } });
    const t = await exportTranslator(i18n, 'en');
    expect(t('accounting.col.date')).toBe('Booking date');
    expect(t('accounting.col.gross')).toBe('Gross');
  });

  it('serves an uploaded language that is not bundled and falls back to the base catalogue for missing keys', async () => {
    const i18n = i18nWith({ de: { 'accounting.col.date': 'Datum' } });
    const t = await exportTranslator(i18n, 'de');
    expect(t('accounting.col.date')).toBe('Datum');
    expect(t('accounting.col.gross')).toBe(BUNDLED_MESSAGES.tr['accounting.col.gross']);
  });

  it('layers the base language under a regional locale and ignores a disabled language', async () => {
    const i18n = i18nWith({ en: { ...BUNDLED_MESSAGES.en, 'accounting.col.net': 'Net (ex tax)' }, 'en-GB': { 'accounting.col.date': 'Posting date' } });
    const t = await exportTranslator(i18n, 'en-GB');
    expect(t('accounting.col.date')).toBe('Posting date');
    expect(t('accounting.col.net')).toBe('Net (ex tax)');
    expect(t('accounting.col.gross')).toBe('Gross');

    const disabled = await exportTranslator(i18nWith({}), 'en');
    expect(disabled('accounting.col.gross')).toBe('Gross');
  });
});
