import { BadRequestException } from '@nestjs/common';
import { apiError, fieldError } from './api-error';
import { errorMessageIn, localeFromAcceptLanguage, pickBundledLocale, recipientLocale, serverT } from './server-i18n';
import { activityBodyFor, activityFields, activityText } from '../modules/crm/activity-text';
import { NotificationsService } from '../modules/notifications/notifications.service';
import type { MessagingService } from '../modules/messaging/engine/messaging.service';
import type { PrismaService } from '../modules/prisma/prisma.service';
import { vmsg } from '@platform/shared';

describe('server-side translator', () => {
  it('renders bundled locales and falls back to Turkish for an unknown one', () => {
    expect(serverT('en')('apiTexts.cancel.cancelled')).toBe('The booking was cancelled.');
    expect(serverT('tr')('apiTexts.cancel.cancelled')).toBe('Rezervasyon iptal edildi.');
    expect(serverT('de')('apiTexts.cancel.cancelled')).toBe('Rezervasyon iptal edildi.');
    expect(serverT('en-GB')('apiTexts.cancel.cancelled')).toBe('The booking was cancelled.');
  });

  it('picks plural forms by count', () => {
    expect(serverT('en')('apiTexts.referral.offerText', { count: 1 })).toContain('1 extra session credit.');
    expect(serverT('en')('apiTexts.referral.offerText', { count: 3 })).toContain('3 extra session credits.');
  });

  it('chooses the first bundled candidate and ends on Turkish', () => {
    expect(pickBundledLocale([null, 'fr', 'en-US'])).toBe('en');
    expect(pickBundledLocale([undefined, 'fr'])).toBe('tr');
  });

  it('reads the request language from Accept-Language', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,tr;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('tr')).toBe('tr');
    expect(localeFromAcceptLanguage(undefined)).toBe('tr');
    expect(localeFromAcceptLanguage('fr-FR')).toBe('tr');
  });
});

describe('recipientLocale', () => {
  const db = (user: string | null, contact: string | null, studio: string | null) =>
    ({
      user: { findUnique: jest.fn().mockResolvedValue(user === null ? null : { locale: user }) },
      contact: { findUnique: jest.fn().mockResolvedValue(contact === null ? null : { locale: contact }) },
      studio: { findUnique: jest.fn().mockResolvedValue(studio === null ? null : { defaultLocale: studio }) },
    }) as never;

  it('prefers the user, then the contact, then the business default, then Turkish', async () => {
    expect(await recipientLocale(db('en', null, 'tr'), { userId: 'u', studioId: 's' })).toBe('en');
    expect(await recipientLocale(db(null, 'en', 'tr'), { contactId: 'c', studioId: 's' })).toBe('en');
    expect(await recipientLocale(db(null, null, 'en'), { userId: 'u', studioId: 's' })).toBe('en');
    expect(await recipientLocale(db(null, null, null), { userId: 'u', studioId: 's' })).toBe('tr');
  });
});

describe('error and validation bodies', () => {
  it('translates the message of an apiError exception into the reader language', () => {
    const err = new BadRequestException(apiError('apiErrors.common.memberNotFound'));
    expect(errorMessageIn(err, serverT('en'))).toBe('Member not found');
    expect(errorMessageIn(err, serverT('tr'))).toBe('Üye bulunamadı');
  });

  it('keeps Turkish text and the key for a validation message', () => {
    expect(fieldError('name', vmsg('validation.nameLeast2Characters'))).toEqual({
      path: 'name',
      message: expect.stringContaining('en az 2'),
      messageKey: 'validation.nameLeast2Characters',
    });
    expect(fieldError('x', 'Plain sentence')).toEqual({ path: 'x', message: 'Plain sentence' });
  });
});

describe('CRM timeline text', () => {
  it('stores a key and renders it in the viewer language', () => {
    const { body, i18n } = activityFields(activityText('apiTexts.crm.stageChanged', { from: 'NEW', to: 'TRIAL' }));
    expect(body).toBe('Aşama değişti: NEW -> TRIAL');
    expect(activityBodyFor({ body, metadata: { i18n } }, serverT('en'))).toBe('Stage changed: NEW -> TRIAL');
  });

  it('shows a free-text note unchanged', () => {
    expect(activityBodyFor({ body: 'Called, call back Monday', metadata: null }, serverT('en'))).toBe('Called, call back Monday');
    expect(activityBodyFor({ body: 'x', metadata: { i18n: { key: 'not.a.crm.key' } } }, serverT('en'))).toBe('x');
  });
});

describe('NotificationsService.notifyUser with message keys', () => {
  function build(userLocale: string | null, studioLocale: string | null) {
    const send = jest.fn().mockResolvedValue({ success: true, pushedDevices: 1 });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ locale: userLocale }) },
      contact: { findUnique: jest.fn() },
      studio: { findUnique: jest.fn().mockResolvedValue({ defaultLocale: studioLocale }) },
    };
    const service = new NotificationsService({ send } as unknown as MessagingService, prisma as unknown as PrismaService);
    return { send, service };
  }

  it('writes the push in the recipient language, with computed parameters', async () => {
    const { send, service } = build('en', 'tr');
    await service.notifyUser({
      userId: 'u',
      studioId: 's',
      category: 'BOOKING_CHANGE',
      message: { titleKey: 'apiTexts.notify.sessionMoved.title', bodyKey: 'apiTexts.notify.sessionMoved.body', bodyParams: ({ locale }) => ({ when: locale }) },
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ subject: 'Your session time has changed', text: 'Your booked session has been moved to en.' }) }));
  });

  it('falls back to the business language, then Turkish', async () => {
    const studio = build(null, 'en');
    await studio.service.notifyUser({ userId: 'u', studioId: 's', category: 'WAITLIST', message: { titleKey: 'apiTexts.notify.waitlistFailed.title', bodyText: 'x' } });
    expect(studio.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ subject: 'Waitlist' }) }));
    const base = build(null, null);
    await base.service.notifyUser({ userId: 'u', studioId: 's', category: 'WAITLIST', message: { titleKey: 'apiTexts.notify.waitlistFailed.title', bodyText: 'x' } });
    expect(base.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ subject: 'Bekleme listesi' }) }));
  });
});
