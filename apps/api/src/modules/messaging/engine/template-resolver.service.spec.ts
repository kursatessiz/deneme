import { localeChain, pickTemplate } from './template-resolver.service';

type Row = Parameters<typeof pickTemplate>[0][number];

function row(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? `${overrides.studioId ?? 'global'}-${overrides.locale ?? 'tr'}`,
    studioId: null,
    key: 'BOOKING_REMINDER',
    locale: 'tr',
    body: 'body',
    subject: null,
    blocks: null,
    whatsappTemplateName: null,
    whatsappStatus: 'APPROVED',
    isTransactional: true,
    ...overrides,
  };
}

describe('localeChain', () => {
  it('orders recipient, its base language, studio default, then tr, without duplicates', () => {
    expect(localeChain('pt-BR', 'en')).toEqual(['pt-BR', 'pt', 'en', 'tr']);
    expect(localeChain('en', 'en')).toEqual(['en', 'tr']);
    expect(localeChain(null, null)).toEqual(['tr']);
    expect(localeChain('tr', 'de')).toEqual(['tr', 'de']);
  });
});

describe('pickTemplate (template locale fallback)', () => {
  const STUDIO = 'studio-1';

  it('prefers the tenant override, then the global row, then the built-in default, per locale', () => {
    const rows = [row({ studioId: STUDIO, locale: 'tr', body: 'tenant tr' }), row({ locale: 'tr', body: 'global tr' })];
    expect(pickTemplate(rows, STUDIO, 'BOOKING_REMINDER', 'SMS', ['tr'])?.body).toBe('tenant tr');
    expect(pickTemplate(rows, 'other-studio', 'BOOKING_REMINDER', 'SMS', ['tr'])?.body).toBe('global tr');
  });

  it('the recipient language wins over a tenant override in another language', () => {
    const rows = [row({ studioId: STUDIO, locale: 'tr', body: 'tenant tr' })];
    const picked = pickTemplate(rows, STUDIO, 'BOOKING_REMINDER', 'SMS', ['en', 'tr']);
    expect(picked?.source).toBe('BUILTIN');
    expect(picked?.locale).toBe('en');
    expect(picked?.body).toContain('your {serviceName} session');
  });

  it('falls back to the studio default and then Turkish when the language has nothing', () => {
    const rows = [row({ locale: 'en', body: 'global en' })];
    expect(pickTemplate(rows, STUDIO, 'CUSTOM_KEY', 'SMS', ['de', 'en', 'tr'])?.body).toBe('global en');
    const tr = pickTemplate([], STUDIO, 'BOOKING_REMINDER', 'SMS', ['de', 'tr']);
    expect(tr?.locale).toBe('tr');
    expect(tr?.source).toBe('BUILTIN');
  });

  it('returns null for an unknown key with no rows', () => {
    expect(pickTemplate([], STUDIO, 'NOPE', 'SMS', ['tr'])).toBeNull();
  });

  it('parses stored email blocks and drops invalid ones', () => {
    const good = row({ locale: 'en', key: 'X', subject: 'Hi', blocks: [{ type: 'heading', text: 'Hi' }] });
    expect(pickTemplate([good], STUDIO, 'X', 'EMAIL', ['en'])?.blocks).toEqual([{ type: 'heading', text: 'Hi' }]);
    const bad = row({ locale: 'en', key: 'X', subject: 'Hi', blocks: [{ type: 'script', text: 'x' }] });
    expect(pickTemplate([bad], STUDIO, 'X', 'EMAIL', ['en'])?.blocks).toBeNull();
  });

  it('carries the WhatsApp approval status; unknown values read as pending', () => {
    const r = row({ whatsappTemplateName: 'x', whatsappStatus: 'weird' });
    expect(pickTemplate([r], null, 'BOOKING_REMINDER', 'WHATSAPP', ['tr'])?.whatsappStatus).toBe('PENDING');
  });
});
