import {
  NOTIFICATION_CATEGORIES,
  RegisterPushDeviceSchema,
  UpdateNotificationPreferencesSchema,
  resolveNotificationPreferences,
} from './notifications';

describe('notification preferences', () => {
  it('marketing is off by default on every channel', () => {
    expect(NOTIFICATION_CATEGORIES.MARKETING.defaults).toEqual({ push: false, sms: false });
  });

  it('applies stored overrides on top of defaults', () => {
    const items = resolveNotificationPreferences([{ category: 'BOOKING_REMINDER', push: false, sms: true }], {
      includeStaff: false,
    });
    const reminder = items.find((i) => i.category === 'BOOKING_REMINDER')!;
    expect(reminder).toMatchObject({ push: false, sms: true });
    expect(items.find((i) => i.category === 'WAITLIST')).toMatchObject({ push: true, sms: true });
  });

  it('hides staff-only categories from non-staff users', () => {
    const categories = (includeStaff: boolean) =>
      resolveNotificationPreferences([], { includeStaff }).map((i) => i.category);
    expect(categories(false)).not.toContain('TRAINER_SCHEDULE');
    expect(categories(true)).toContain('TRAINER_SCHEDULE');
  });

  it('rejects unknown categories and extra fields', () => {
    expect(UpdateNotificationPreferencesSchema.safeParse({ preferences: { OTP: { push: false, sms: false } } }).success).toBe(false);
    expect(
      UpdateNotificationPreferencesSchema.safeParse({ preferences: { WAITLIST: { push: true, sms: true, email: true } } })
        .success,
    ).toBe(false);
    expect(UpdateNotificationPreferencesSchema.safeParse({ preferences: { WAITLIST: { push: false, sms: true } } }).success).toBe(true);
  });

  it('accepts only Expo push tokens', () => {
    expect(RegisterPushDeviceSchema.safeParse({ token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'ios' }).success).toBe(true);
    expect(RegisterPushDeviceSchema.safeParse({ token: 'https://evil.example/hook', platform: 'ios' }).success).toBe(false);
  });
});
