import type { ConfigService } from '@nestjs/config';
import { DomainNoticeService, SITE_MANAGE_PERMISSION } from './domain-notice.service';
import type { DomainNoticeTarget } from './domain-notice.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessagingService } from '../messaging/engine/messaging.service';

const target: DomainNoticeTarget = { domainId: 'd1', domain: 'www.example.com', studioId: 's1', isPlatformStudio: false, eventAt: new Date('2026-10-13T08:00:00Z') };

function build(memberships: { id: string }[], send: jest.Mock = jest.fn().mockResolvedValue({ success: true })) {
  const prisma = { membership: { findMany: jest.fn().mockResolvedValue(memberships) } };
  const config = { get: jest.fn().mockReturnValue('https://app.example.com/') };
  const service = new DomainNoticeService(prisma as unknown as PrismaService, { send } as unknown as MessagingService, config as unknown as ConfigService);
  return { service, prisma, send };
}

describe('DomainNoticeService', () => {
  it('resolves the owner and staff holding site.manage, active and not erased', async () => {
    const { service, prisma } = build([{ id: 'm1' }]);
    await service.recipients('s1');
    expect(prisma.membership.findMany.mock.calls[0][0].where).toEqual({
      studioId: 's1',
      status: 'ACTIVE',
      erasedAt: null,
      OR: [{ roleTemplate: { isOwner: true } }, { roleTemplate: { permissions: { some: { permissionKey: SITE_MANAGE_PERMISSION } } } }],
    });
    expect(SITE_MANAGE_PERMISSION).toBe('site.manage');
  });

  it('sends the warning as transactional e-mail and in-app notice only, never SMS, to each recipient', async () => {
    const { service, send } = build([{ id: 'm1' }, { id: 'm2' }]);
    expect(await service.warnFirstFailure(target, 2, 'sites.example.com')).toBe(4);
    expect(send).toHaveBeenCalledTimes(4);
    const channels = send.mock.calls.map((c) => c[0].channel).sort();
    expect(channels).toEqual(['EMAIL', 'EMAIL', 'IN_APP', 'IN_APP']);
    const first = send.mock.calls[0][0];
    expect(first).toEqual(
      expect.objectContaining({
        studioId: 's1',
        recipient: { membershipId: 'm1' },
        purpose: 'TRANSACTIONAL',
        billing: 'EXEMPT',
        templateKey: 'DOMAIN_VERIFY_WARNING',
        variables: { domain: 'www.example.com', link: 'https://app.example.com/ayarlar/web-sitem', days: 2, cnameTarget: 'sites.example.com' },
      }),
    );
  });

  it('sends the deactivation notice with a per event idempotency key and the platform link for the platform studio', async () => {
    const { service, send } = build([{ id: 'm1' }]);
    await service.notifyDeactivated({ ...target, isPlatformStudio: true });
    const input = send.mock.calls[0][0];
    expect(input.templateKey).toBe('DOMAIN_DEACTIVATED');
    expect(input.variables.link).toBe('https://app.example.com/pazarlama/site');
    expect(input.idempotencyKey).toContain('domain-deactivated:d1:');
  });

  it('does not count duplicates and survives a send failure', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce({ success: true, duplicate: true }).mockResolvedValue({ success: true });
    const { service } = build([{ id: 'm1' }, { id: 'm2' }], send);
    expect(await service.notifyDeactivated(target)).toBe(2);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('never throws when the recipient lookup fails', async () => {
    const { service, prisma, send } = build([]);
    prisma.membership.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.warnFirstFailure(target, 2, 'x')).resolves.toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
