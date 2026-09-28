import {
  MessageRenderError,
  MessagingSettingsSchema,
  classifyInboundKeyword,
  countryOfPhone,
  frequencyCapReached,
  messagePlaceholders,
  normalizeKeyword,
  parseMessagingSettings,
  recipientRegion,
  renderMessageText,
  renderMessageTextLenient,
  whatsappWindowOpen,
} from './messaging-engine';
import { emailBrandOf, emailLinkTargets, interpolateEmailBlocks, isSafeHttpUrl, renderEmail } from './email-blocks';
import type { EmailBlock } from './email-blocks';
import { BUILTIN_TEMPLATES, builtinTemplateContent, builtinTemplateMessageKeys, TenantTemplateUpsertSchema } from './message-templates';
import { BUNDLED_MESSAGES } from './i18n/messages';
import { InboxReplySchema } from './inbox';

describe('renderMessageText', () => {
  it('interpolates {name} placeholders with the shared translator', () => {
    expect(renderMessageText('Merhaba {firstName}, {serviceName}', { firstName: 'Ada', serviceName: 'Reformer' })).toBe(
      'Merhaba Ada, Reformer',
    );
  });

  it('still reads legacy {{name}} templates', () => {
    expect(renderMessageText('Merhaba {{ firstName }} ve {x}', { firstName: 'Ada', x: 'Y' })).toBe('Merhaba Ada ve Y');
  });

  it('throws with the missing names instead of sending a half-rendered message', () => {
    expect(() => renderMessageText('Merhaba {firstName} {{lastName}}', {})).toThrow(MessageRenderError);
    try {
      renderMessageText('Merhaba {firstName} {{lastName}}', {});
    } catch (err) {
      expect((err as MessageRenderError).missing).toEqual(['firstName', 'lastName']);
    }
  });

  it('never re-reads a substituted value as a placeholder', () => {
    expect(renderMessageText('{a} {{b}}', { a: '{b}', b: '{a}' })).toBe('{b} {a}');
  });

  it('formats numbers for the locale', () => {
    expect(renderMessageText('{n}', { n: 1234.5 }, 'en')).toBe('1,234.5');
  });

  it('lenient rendering keeps missing placeholders visible for previews', () => {
    expect(renderMessageTextLenient('Hi {firstName} {{x}}', { firstName: 'Ada' })).toBe('Hi Ada {x}');
  });

  it('lists placeholders of either syntax', () => {
    expect(messagePlaceholders('{b} {{a}} {b}')).toEqual(['a', 'b']);
  });
});

describe('messaging settings and frequency caps', () => {
  it('defaults to 3 per day and 10 per week', () => {
    expect(parseMessagingSettings(undefined).frequencyCap).toEqual({ perDay: 3, perWeek: 10 });
    expect(parseMessagingSettings({ nonsense: 1 }).frequencyCap).toEqual({ perDay: 3, perWeek: 10 });
  });

  it('accepts a tenant cap and SMS provider override', () => {
    const parsed = parseMessagingSettings({ frequencyCap: { perDay: 1, perWeek: 2 }, smsProvider: 'TWILIO' });
    expect(parsed.frequencyCap).toEqual({ perDay: 1, perWeek: 2 });
    expect(parsed.smsProvider).toBe('TWILIO');
  });

  it('rejects a weekly cap below the daily cap and unknown providers', () => {
    expect(MessagingSettingsSchema.safeParse({ frequencyCap: { perDay: 5, perWeek: 2 } }).success).toBe(false);
    expect(MessagingSettingsSchema.safeParse({ smsProvider: 'CARRIER_PIGEON' }).success).toBe(false);
  });

  it('reaches the cap on either window', () => {
    const cap = { perDay: 3, perWeek: 10 };
    expect(frequencyCapReached({ lastDay: 2, lastWeek: 9 }, cap)).toBe(false);
    expect(frequencyCapReached({ lastDay: 3, lastWeek: 3 }, cap)).toBe(true);
    expect(frequencyCapReached({ lastDay: 0, lastWeek: 10 }, cap)).toBe(true);
    expect(frequencyCapReached({ lastDay: 0, lastWeek: 0 }, { perDay: 0, perWeek: 0 })).toBe(true);
  });
});

describe('inbound keywords per region', () => {
  it('normalises Turkish letters and punctuation', () => {
    expect(normalizeKeyword(' İptal. ')).toBe('IPTAL');
    expect(normalizeKeyword('ıptal')).toBe('IPTAL');
    expect(normalizeKeyword('Stop!')).toBe('STOP');
  });

  it.each([
    ['STOP', 'TR', 'OPT_OUT'],
    ['iptal', 'TR', 'OPT_OUT'],
    ['DUR', 'US', 'OPT_OUT'],
    ['RET', 'TR', 'OPT_OUT'],
    ['RET', 'US', null],
    ['CANCEL', 'US', 'OPT_OUT'],
    ['CANCEL', 'TR', null],
    ['Unsubscribe', 'EU', 'OPT_OUT'],
    ['HELP', 'EU', 'HELP'],
    ['yardım', 'TR', 'HELP'],
    ['INFO', 'US', 'HELP'],
    ['INFO', 'TR', null],
    ['stop the class please', 'US', null],
    ['Merhaba', 'TR', null],
  ] as const)('%s in %s -> %s', (text, region, expected) => {
    expect(classifyInboundKeyword(text, region)).toBe(expected);
  });

  it('derives the region from the phone when the contact has no country', () => {
    expect(countryOfPhone('+905321000016')).toBe('TR');
    expect(countryOfPhone('+12025550143')).toBe('US');
    expect(countryOfPhone('garbage')).toBeNull();
    expect(recipientRegion({ phone: '+442071838750' })).toBe('UK');
    expect(recipientRegion({ countryCode: 'DE', phone: '+905321000016' })).toBe('EU');
    expect(recipientRegion({ studioCountryCode: 'TR' })).toBe('TR');
  });
});

describe('WhatsApp customer-service window', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  it('is open for 24 hours after the last inbound message', () => {
    expect(whatsappWindowOpen(new Date('2026-06-14T12:00:01.000Z'), now)).toBe(true);
    expect(whatsappWindowOpen('2026-06-14T12:00:00.000Z', now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
    expect(whatsappWindowOpen(new Date('2026-06-15T13:00:00.000Z'), now)).toBe(false);
  });
});

describe('email block renderer', () => {
  const brand = emailBrandOf({ name: 'Zen & Co', logoUrl: null, themeFamily: 'noir', themePrimary: '#2F6F5E', gradientPresetKey: null });
  const blocks: EmailBlock[] = [
    { type: 'heading', text: 'Merhaba {firstName}' },
    { type: 'paragraph', text: 'Satır 1\n<b>kalın değil</b>' },
    { type: 'button', label: 'Rezervasyon', url: '{bookingUrl}' },
    { type: 'image', src: 'https://cdn.example.com/a.png', alt: 'Stüdyo', href: 'https://example.com/galeri' },
    { type: 'divider' },
    { type: 'footer', text: 'Görüşmek üzere' },
  ];

  it('renders a stable responsive, inline-styled document and a plain-text part', () => {
    const rendered = interpolateEmailBlocks(blocks, { firstName: 'Ada', bookingUrl: 'https://example.com/b?x=1&y=2' }, 'tr');
    const email = renderEmail({
      lang: 'tr',
      subject: 'Konu',
      preheader: 'Önizleme',
      blocks: rendered,
      brand,
      footer: {
        physicalAddress: 'Moda Cad. 1, İstanbul',
        reasonText: 'Bu e-postayı izniniz olduğu için aldınız.',
        unsubscribe: { url: 'https://app.example.com/m/u/tok', label: 'Abonelikten çık' },
      },
      openPixelUrl: 'https://api.example.com/m/o/tok',
      rewriteLink: (url) => `https://app.example.com/m/c/${encodeURIComponent(url).length}`,
    });
    expect(email.html).toMatchSnapshot();
    expect(email.text).toMatchSnapshot();
    expect(email.html).toContain('&lt;b&gt;kalın değil&lt;/b&gt;');
    expect(email.html).toContain('Zen &amp; Co, Moda Cad. 1, İstanbul');
    expect(email.html).toContain('https://app.example.com/m/u/tok');
    expect(email.html).toContain('max-width:620px');
  });

  it('drops unsafe URLs instead of rendering them', () => {
    const email = renderEmail({
      lang: 'en',
      subject: 's',
      blocks: [{ type: 'button', label: 'x', url: 'javascript:alert(1)' }],
      brand,
      footer: { physicalAddress: null, reasonText: 'r', unsubscribe: null },
    });
    expect(email.html).not.toContain('javascript:');
    expect(isSafeHttpUrl('https://example.com/a?b=c')).toBe(true);
    expect(isSafeHttpUrl('https://exa mple.com')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,x')).toBe(false);
  });

  it('collects only http(s) link targets for click tracking', () => {
    expect(
      emailLinkTargets([
        { type: 'button', label: 'a', url: 'https://a.example.com' },
        { type: 'button', label: 'b', url: 'https://a.example.com' },
        { type: 'image', src: 'https://c.example.com/i.png', alt: '', href: 'https://b.example.com' },
        { type: 'button', label: 'c', url: '{notRendered}' },
      ]),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('strict interpolation of blocks throws on a missing variable', () => {
    expect(() => interpolateEmailBlocks([{ type: 'paragraph', text: '{missing}' }], {})).toThrow(MessageRenderError);
  });
});

describe('built-in templates', () => {
  it('every built-in template has tr and en texts', () => {
    for (const key of builtinTemplateMessageKeys()) {
      expect(BUNDLED_MESSAGES.tr[key]).toBeTruthy();
      expect(BUNDLED_MESSAGES.en[key]).toBeTruthy();
    }
  });

  it('builds per-channel content with a locale-specific WhatsApp name and email blocks', () => {
    const sms = builtinTemplateContent('BOOKING_REMINDER', 'SMS', 'en');
    expect(sms?.body).toContain('{serviceName}');
    expect(sms?.subject).toBeNull();
    const wa = builtinTemplateContent('BOOKING_REMINDER', 'WHATSAPP', 'tr');
    expect(wa?.whatsappTemplateName).toBe('booking_reminder_tr');
    const email = builtinTemplateContent('INVITE_LINK', 'EMAIL', 'tr');
    expect(email?.subject).toBe('{studioName} sizi davet ediyor');
    expect(email?.blocks?.map((b) => b.type)).toEqual(['heading', 'paragraph', 'button']);
    expect(builtinTemplateContent('WIN_BACK', 'SMS', 'tr')?.isTransactional).toBe(false);
    expect(builtinTemplateContent('NOPE', 'SMS', 'tr')).toBeNull();
    expect(builtinTemplateContent('OTP', 'SMS', 'xx')).toBeNull();
  });

  it('texts only use the variables each template declares', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const locale of ['tr', 'en']) {
        const content = builtinTemplateContent(t.key, 'EMAIL', locale)!;
        const used = new Set([...messagePlaceholders(content.body), ...messagePlaceholders(content.subject ?? '')]);
        for (const name of used) expect(t.variables).toContain(name);
      }
    }
  });

  it('the tenant editor requires a subject for email and an approved name for WhatsApp', () => {
    const base = { key: 'WIN_BACK', locale: 'en', body: 'x' };
    expect(TenantTemplateUpsertSchema.safeParse({ ...base, channel: 'EMAIL' }).success).toBe(false);
    expect(TenantTemplateUpsertSchema.safeParse({ ...base, channel: 'EMAIL', subject: 's' }).success).toBe(true);
    expect(TenantTemplateUpsertSchema.safeParse({ ...base, channel: 'WHATSAPP' }).success).toBe(false);
  });
});

describe('inbox reply schema', () => {
  it('needs exactly one of body or template', () => {
    expect(InboxReplySchema.safeParse({ body: 'hi' }).success).toBe(true);
    expect(InboxReplySchema.safeParse({ templateKey: 'WIN_BACK' }).success).toBe(true);
    expect(InboxReplySchema.safeParse({}).success).toBe(false);
    expect(InboxReplySchema.safeParse({ body: 'hi', templateKey: 'WIN_BACK' }).success).toBe(false);
  });
});
