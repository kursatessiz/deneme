import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mockDkimTokens } from '@platform/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DnsLookup } from './email-domain-dns';
import { EmailDomainService, toEmailDomainDto } from './email-domain.service';
import { MockSesIdentityClient, type SesEnsureResult, type SesIdentityInfo, type SesIdentityPort } from './ses-identity.port';

const TOKENS = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccc'];

function notFound(): Error {
  return Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
}
const emptyDns: DnsLookup = {
  resolveTxt: async () => {
    throw notFound();
  },
  resolveCname: async () => {
    throw notFound();
  },
  resolveMx: async () => {
    throw notFound();
  },
};

function domainRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dom-1',
    studioId: 'platform-1',
    domain: 'news.example.com',
    purpose: 'MARKETING',
    mailFromDomain: null,
    dkimTokens: [],
    spfStatus: 'PENDING',
    dkimStatus: 'PENDING',
    dmarcStatus: 'PENDING',
    dmarcPolicy: null,
    lastCheckedAt: null,
    lastError: null,
    warmupStartedAt: null,
    dailyCap: null,
    sesProvisionedAt: null,
    sesVerificationStatus: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

/** A tiny in-memory prisma: one domain row, updates merge into it. */
function fakePrisma(initial: ReturnType<typeof domainRow>) {
  let row = initial;
  const audit: Array<Record<string, unknown>> = [];
  const tx = {
    emailSenderDomain: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data } as typeof row;
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    emailSenderDomain: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; studioId: string } }) => (where.id === row.id && where.studioId === row.studioId ? row : null)),
      findMany: jest.fn(async () => [row]),
    },
    studio: { findFirst: jest.fn(async () => ({ id: 'platform-1' })) },
    auditLog: tx.auditLog,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaService, audit, current: () => row };
}

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Stateful SES fake: statuses are driven by the test. */
class FakeSes implements SesIdentityPort {
  readonly provider = 'SES' as const;
  identity: SesIdentityInfo | null = null;
  fail = false;
  ensureCalls = 0;
  async ensureIdentity(): Promise<SesEnsureResult> {
    this.ensureCalls += 1;
    if (this.fail) throw new Error('AccessDenied');
    const created = this.identity === null;
    this.identity ??= { dkimTokens: TOKENS, dkimStatus: 'PENDING', verificationStatus: 'PENDING' };
    return { created, info: this.identity };
  }
  async getIdentity(): Promise<SesIdentityInfo | null> {
    if (this.fail) throw new Error('Throttling');
    return this.identity;
  }
}

describe('EmailDomainService.provision', () => {
  it('creates the identity, stores the tokens and returns the records to publish', async () => {
    const { prisma, audit, current } = fakePrisma(domainRow());
    const ses = new FakeSes();
    const service = new EmailDomainService(prisma, config({ SES_REGION: 'eu-central-1' }), emptyDns, ses);
    const result = await service.provision('platform-1', 'user-1', 'dom-1');
    expect(result.provider).toBe('SES');
    expect(result.created).toBe(true);
    expect(current().dkimTokens).toEqual(TOKENS);
    expect(current().dkimStatus).toBe('MISSING');
    expect(current().sesVerificationStatus).toBe('PENDING');
    expect(result.records.filter((r) => r.kind === 'DKIM').map((r) => r.value)).toEqual(TOKENS.map((t) => `${t}.dkim.amazonses.com`));
    expect(audit[0]).toMatchObject({ action: 'marketing.sender_domain.ses_provisioned', studioId: 'platform-1', userId: 'user-1', entityId: 'dom-1' });

    const again = await service.provision('platform-1', 'user-1', 'dom-1');
    expect(again.created).toBe(false);
    expect(ses.ensureCalls).toBe(2);
  });

  it('returns deterministic fake tokens with the mock provider', async () => {
    const { prisma, current } = fakePrisma(domainRow());
    const service = new EmailDomainService(prisma, config(), emptyDns, new MockSesIdentityClient());
    const result = await service.provision('platform-1', 'user-1', 'dom-1');
    expect(result.provider).toBe('MOCK');
    expect(current().dkimTokens).toEqual(mockDkimTokens('news.example.com'));
    expect(current().dkimStatus).toBe('PENDING');
  });

  it('refuses the mock in production, is tenant scoped and maps an SES failure to a bad gateway', async () => {
    const { prisma } = fakePrisma(domainRow());
    await expect(new EmailDomainService(prisma, config({ NODE_ENV: 'production' }), emptyDns, new MockSesIdentityClient()).provision('platform-1', 'u', 'dom-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const ses = new FakeSes();
    const service = new EmailDomainService(prisma, config(), emptyDns, ses);
    await expect(service.provision('other-studio', 'u', 'dom-1')).rejects.toBeInstanceOf(NotFoundException);
    ses.fail = true;
    await expect(service.provision('platform-1', 'u', 'dom-1')).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('EmailDomainService.check', () => {
  it('reads DKIM and the verification status from SES when it is configured', async () => {
    const { prisma, current } = fakePrisma(domainRow({ dkimTokens: TOKENS }));
    const ses = new FakeSes();
    ses.identity = { dkimTokens: TOKENS, dkimStatus: 'SUCCESS', verificationStatus: 'SUCCESS' };
    const service = new EmailDomainService(prisma, config({ SES_REGION: 'eu-central-1' }), emptyDns, ses);
    const outcome = await service.check(current() as never);
    expect(outcome.row.dkimStatus).toBe('VALID');
    expect(outcome.row.sesVerificationStatus).toBe('SUCCESS');
    expect(outcome.records.filter((r) => r.kind === 'DKIM').every((r) => r.status === 'VALID')).toBe(true);
    // SPF and DMARC still come from DNS (nothing published in the fake zone).
    expect(outcome.row.spfStatus).toBe('MISSING');
    expect(outcome.changed).toBe(true);
  });

  it('adopts the tokens SES reports when the identity was created outside the platform', async () => {
    const { prisma, current } = fakePrisma(domainRow());
    const ses = new FakeSes();
    ses.identity = { dkimTokens: TOKENS, dkimStatus: 'PENDING', verificationStatus: 'PENDING' };
    const service = new EmailDomainService(prisma, config(), emptyDns, ses);
    await service.check(current() as never);
    expect(current().dkimTokens).toEqual(TOKENS);
    expect(current().dkimStatus).toBe('MISSING');
  });

  it('falls back to the DNS lookup when SES cannot answer, and notes the error', async () => {
    const { prisma, current } = fakePrisma(domainRow({ dkimTokens: TOKENS }));
    const ses = new FakeSes();
    ses.fail = true;
    const dns: DnsLookup = {
      ...emptyDns,
      resolveCname: async (name) => {
        const token = TOKENS.find((t) => name.startsWith(`${t}.`));
        if (token) return [`${token}.dkim.amazonses.com`];
        throw notFound();
      },
    };
    const service = new EmailDomainService(prisma, config(), dns, ses);
    const outcome = await service.check(current() as never);
    expect(outcome.row.dkimStatus).toBe('VALID');
    expect(outcome.row.lastError).toContain('SES:');
  });

  it('is DNS-only without SES credentials (the mock never answers for the domain)', async () => {
    const { prisma, current } = fakePrisma(domainRow({ dkimTokens: TOKENS }));
    const service = new EmailDomainService(prisma, config(), emptyDns, new MockSesIdentityClient());
    const outcome = await service.check(current() as never);
    expect(outcome.row.dkimStatus).toBe('MISSING');
    expect(outcome.row.sesVerificationStatus).toBeNull();
  });
});

describe('EmailDomainService.processDue', () => {
  it('checks a never checked domain, audits the change and re-checks an unverified one only after an hour', async () => {
    const fake = fakePrisma(domainRow({ dkimTokens: TOKENS }));
    const ses = new FakeSes();
    ses.identity = { dkimTokens: TOKENS, dkimStatus: 'SUCCESS', verificationStatus: 'SUCCESS' };
    const service = new EmailDomainService(fake.prisma, config(), emptyDns, ses);
    expect(await service.processDue(new Date())).toEqual({ checked: 1, failed: 0 });
    expect(fake.audit.some((a) => a.action === 'integration.email_domain.check' && (a.metadata as { via: string }).via === 'heartbeat')).toBe(true);
    expect(await service.processDue(new Date())).toEqual({ checked: 0, failed: 0 });
    expect((await service.processDue(new Date(Date.now() + 2 * 3_600_000))).checked).toBe(1);
  });

  it('counts a failing domain and keeps going', async () => {
    const fake = fakePrisma(domainRow({ dkimTokens: TOKENS }));
    (fake.prisma as unknown as { $transaction: jest.Mock }).$transaction.mockRejectedValueOnce(new Error('db down'));
    const service = new EmailDomainService(fake.prisma, config(), emptyDns, new MockSesIdentityClient());
    expect(await service.processDue(new Date())).toEqual({ checked: 0, failed: 1 });
  });
});

describe('toEmailDomainDto', () => {
  it('shows the stored aggregate status per record and the SES fields', () => {
    const dto = toEmailDomainDto(domainRow({ dkimTokens: TOKENS, dkimStatus: 'VALID', sesProvisionedAt: new Date('2026-10-02T00:00:00Z'), sesVerificationStatus: 'SUCCESS' }) as never, 'eu-central-1');
    expect(dto.sesVerificationStatus).toBe('SUCCESS');
    expect(dto.sesProvisionedAt).toBe('2026-10-02T00:00:00.000Z');
    expect(dto.expectedRecords.filter((r) => r.kind === 'DKIM').every((r) => r.status === 'VALID')).toBe(true);
    expect(dto.verified).toBe(false);
  });
});
