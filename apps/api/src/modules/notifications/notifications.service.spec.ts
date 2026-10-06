import { NotificationsService } from './notifications.service';
import type { MessagingService } from '../messaging/engine/messaging.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * NotificationsService is the compatibility facade over the messaging
 * engine: every legacy entry point must reach MessagingService.send with
 * the same semantics it had before G1c.
 */
describe('NotificationsService (facade over MessagingService)', () => {
  const send = jest.fn();
  const service = new NotificationsService({ send } as unknown as MessagingService, {} as unknown as PrismaService);

  beforeEach(() => send.mockReset());

  it('sendSms goes through the engine as transactional, wallet-exempt, redacted free text', async () => {
    send.mockResolvedValue({ success: true, channel: 'SMS', providerMessageId: 'mock-1' });
    const result = await service.sendSms({
      studioId: null,
      phone: '+905321112233',
      message: 'Giris kodunuz: 482915',
      type: 'LOGIN_OTP',
      sensitive: true,
    });
    expect(result).toEqual({ success: true, messageId: 'mock-1' });
    expect(send).toHaveBeenCalledWith({
      studioId: null,
      recipient: { phone: '+905321112233' },
      channel: 'SMS',
      purpose: 'TRANSACTIONAL',
      type: 'LOGIN_OTP',
      content: { text: 'Giris kodunuz: 482915' },
      sensitive: true,
      billing: 'EXEMPT',
    });
  });

  it('send keeps the template, category and tenant channel order (no channel pinned)', async () => {
    send.mockResolvedValue({ success: false, reason: 'KVKK/İYS ticari ileti onayı yok', reasonCode: 'CONSENT_REQUIRED' });
    const result = await service.send({
      studioId: 's1',
      userId: 'u1',
      category: 'MARKETING',
      template: 'WIN_BACK',
      params: { firstName: 'Ada' },
    });
    expect(result).toEqual({
      success: false,
      channel: undefined,
      providerMessageId: undefined,
      reason: 'KVKK/İYS ticari ileti onayı yok',
      reasonCode: 'CONSENT_REQUIRED',
    });
    const call = send.mock.calls[0][0];
    expect(call).toMatchObject({ studioId: 's1', recipient: { userId: 'u1' }, templateKey: 'WIN_BACK', category: 'MARKETING' });
    expect(call.channel).toBeUndefined();
    expect(call.channels).toBeUndefined();
  });

  it('notifyUser sends push through the engine and SMS text only when given', async () => {
    send.mockResolvedValueOnce({ success: true, channel: 'PUSH', pushedDevices: 2 });
    const pushOnly = await service.notifyUser({
      userId: 'u1',
      studioId: 's1',
      category: 'BOOKING_CHANGE',
      message: { title: 'T', body: 'B' },
    });
    expect(pushOnly).toEqual({ push: 2, sms: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ channel: 'PUSH', category: 'BOOKING_CHANGE', content: { subject: 'T', text: 'B' } });

    send.mockResolvedValueOnce({ success: false, reason: 'Kayıtlı cihaz yok' }).mockResolvedValueOnce({ success: true, channel: 'SMS' });
    const withSms = await service.notifyUser({
      userId: 'u1',
      studioId: 's1',
      category: 'BOOKING_CHANGE',
      message: { title: 'T', body: 'B' },
      smsText: 'SMS metni',
    });
    expect(withSms).toEqual({ push: 0, sms: true });
    expect(send.mock.calls[2][0]).toMatchObject({ channel: 'SMS', billing: 'EXEMPT', content: { text: 'SMS metni' }, category: 'BOOKING_CHANGE' });
  });
});
