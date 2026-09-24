import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsSchema,
  TemplateRenderError,
  effectiveChannelOrder,
  parseNotificationSettings,
  renderTemplate,
  templatePlaceholders,
} from './messaging';

describe('renderTemplate', () => {
  it('substitutes named placeholders', () => {
    expect(renderTemplate('Merhaba {{firstName}}, {{serviceName}} dersiniz basliyor', {
      firstName: 'Ada',
      serviceName: 'Reformer',
    })).toBe('Merhaba Ada, Reformer dersiniz basliyor');
  });

  it('throws when a param is missing', () => {
    expect(() => renderTemplate('Merhaba {{firstName}}', {})).toThrow(TemplateRenderError);
  });

  it('lists placeholders in a body', () => {
    expect(templatePlaceholders('{{a}} ve {{b}} ve {{a}}')).toEqual(['a', 'b']);
  });

  it('extra params beyond what the template uses are fine', () => {
    expect(renderTemplate('Merhaba {{firstName}}', { firstName: 'Ada', extra: 'x' })).toBe('Merhaba Ada');
  });
});

describe('NotificationSettingsSchema', () => {
  it('accepts the default order', () => {
    const result = NotificationSettingsSchema.safeParse(DEFAULT_NOTIFICATION_SETTINGS);
    expect(result.success).toBe(true);
  });

  it('rejects a duplicated channel', () => {
    expect(NotificationSettingsSchema.safeParse({ order: ['SMS', 'SMS'], whatsappEnabled: true }).success).toBe(false);
  });

  it('rejects an unknown channel', () => {
    expect(NotificationSettingsSchema.safeParse({ order: ['EMAIL'], whatsappEnabled: true }).success).toBe(false);
  });

  it('parseNotificationSettings falls back to the default on garbage', () => {
    expect(parseNotificationSettings({ nonsense: true })).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });
});

describe('effectiveChannelOrder', () => {
  it('keeps WhatsApp when enabled', () => {
    expect(effectiveChannelOrder({ order: ['WHATSAPP', 'SMS'], whatsappEnabled: true })).toEqual(['WHATSAPP', 'SMS']);
  });

  it('drops WhatsApp when the tenant disabled it', () => {
    expect(effectiveChannelOrder({ order: ['WHATSAPP', 'SMS'], whatsappEnabled: false })).toEqual(['SMS']);
  });
});
