import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import type { EmailSenderDomain } from '@platform/database';
import { dnsStatusFromSesDkim } from '@platform/shared';
import type { DnsRecordStatus, EmailDomainPurpose, EmailSenderDomainDTO, ExpectedDnsRecordDTO, SesProvisionResultDTO } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DNS_LOOKUP, checkEmailDomainDns, expectedEmailDomainRecords, type DnsLookup, type EmailDomainDnsConfig } from './email-domain-dns';
import { SES_IDENTITY_PORT, type SesIdentityInfo, type SesIdentityPort } from './ses-identity.port';
import { apiError } from '../../../common/api-error';

const HOUR_MS = 3_600_000;
/** A domain that is not fully verified is re-checked this often by the heartbeat; a verified one once a day. */
const UNVERIFIED_RECHECK_MS = HOUR_MS;
const VERIFIED_RECHECK_MS = 24 * HOUR_MS;
const HEARTBEAT_BATCH = 20;

export function domainDnsConfig(d: Pick<EmailSenderDomain, 'domain' | 'mailFromDomain' | 'dkimTokens'>, sesRegion: string | null): EmailDomainDnsConfig {
  const tokens = Array.isArray(d.dkimTokens) ? d.dkimTokens.filter((t): t is string => typeof t === 'string') : [];
  return { domain: d.domain, mailFromDomain: d.mailFromDomain, dkimTokens: tokens, sesRegion };
}

/** The API shape of a sender domain; `checked` are the records of a fresh lookup (otherwise the stored aggregate status is shown per record). */
export function toEmailDomainDto(d: EmailSenderDomain, sesRegion: string | null, checked?: ExpectedDnsRecordDTO[]): EmailSenderDomainDTO {
  const spf = d.spfStatus as DnsRecordStatus;
  const dkim = d.dkimStatus as DnsRecordStatus;
  const dmarc = d.dmarcStatus as DnsRecordStatus;
  const records =
    checked ??
    expectedEmailDomainRecords(domainDnsConfig(d, sesRegion)).map((r) => ({
      ...r,
      status: r.kind === 'SPF' ? spf : r.kind === 'DKIM' ? dkim : r.kind === 'DMARC' ? dmarc : r.status,
    }));
  return {
    id: d.id,
    domain: d.domain,
    purpose: d.purpose as EmailDomainPurpose,
    mailFromDomain: d.mailFromDomain,
    spfStatus: spf,
    dkimStatus: dkim,
    dmarcStatus: dmarc,
    dmarcPolicy: d.dmarcPolicy,
    verified: spf === 'VALID' && dkim === 'VALID' && dmarc === 'VALID',
    expectedRecords: records,
    lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
    lastError: d.lastError,
    dailyCap: d.dailyCap,
    sesProvisionedAt: d.sesProvisionedAt?.toISOString() ?? null,
    sesVerificationStatus: d.sesVerificationStatus,
    createdAt: d.createdAt.toISOString(),
  };
}

export interface EmailDomainCheckOutcome {
  row: EmailSenderDomain;
  records: ExpectedDnsRecordDTO[];
  /** SPF, DKIM, DMARC or the SES verification status differ from what was stored. */
  changed: boolean;
}

export interface EmailDomainHeartbeatResult {
  checked: number;
  failed: number;
}

/** Runs inside the check's transaction, so the audit row and the stored result commit together. */
export type EmailDomainCheckAudit = (tx: Prisma.TransactionClient, outcome: { spf: string; dkim: string; dmarc: string; source: 'SES' | 'DNS' }) => Promise<void>;

/**
 * Sender domain checks and SES identity automation (M5, docs/PAZARLAMA_MODULU.md
 * 5.2). A check reads SPF and DMARC from DNS; DKIM comes from SES
 * (GetEmailIdentity) when SES credentials are configured and the identity
 * exists there, otherwise from the DNS CNAME lookup as before. `provision`
 * creates (or fetches) the SES identity with Easy DKIM and stores its tokens.
 * Without credentials the port is the deterministic mock, which is refused in
 * production so fake tokens can never be published by accident.
 */
@Injectable()
export class EmailDomainService {
  private readonly logger = new Logger(EmailDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(DNS_LOOKUP) private readonly dns: DnsLookup,
    @Inject(SES_IDENTITY_PORT) private readonly ses: SesIdentityPort,
  ) {}

  sesRegion(): string | null {
    return this.config.get<string>('SES_REGION') ?? null;
  }

  /** The stored result of a look at the domain now: SES for DKIM when it can answer, DNS for the rest. */
  async check(domain: EmailSenderDomain, audit?: EmailDomainCheckAudit): Promise<EmailDomainCheckOutcome> {
    let identity: SesIdentityInfo | null = null;
    let sesError: string | null = null;
    if (this.ses.provider === 'SES') {
      try {
        identity = await this.ses.getIdentity(domain.domain);
      } catch (err) {
        sesError = `SES: ${err instanceof Error ? err.name : 'unknown'}`;
        this.logger.warn(`SES identity lookup failed for ${domain.domain}: ${sesError}`);
      }
    }

    const base = domainDnsConfig(domain, this.sesRegion());
    const tokens = identity && identity.dkimTokens.length > 0 ? identity.dkimTokens : base.dkimTokens;
    const dns = await checkEmailDomainDns({ ...base, dkimTokens: tokens }, this.dns);

    // SES knows the identity: its DKIM answer replaces the CNAME lookup (it is what SES itself signs with).
    const dkimFromSes = identity?.dkimStatus ? dnsStatusFromSesDkim(identity.dkimStatus) : null;
    const dkimStatus: DnsRecordStatus = dkimFromSes ?? dns.dkimStatus;
    const records = dkimFromSes ? dns.records.map((r) => (r.kind === 'DKIM' ? { ...r, status: dkimStatus } : r)) : dns.records;
    const errors = [dns.error, sesError].filter((e): e is string => Boolean(e));
    const verificationStatus = identity?.verificationStatus ?? domain.sesVerificationStatus;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.emailSenderDomain.update({
        where: { id: domain.id },
        data: {
          spfStatus: dns.spfStatus,
          dkimStatus,
          dmarcStatus: dns.dmarcStatus,
          dmarcPolicy: dns.dmarcPolicy,
          lastCheckedAt: new Date(),
          lastError: errors.length > 0 ? errors.join('; ').slice(0, 500) : null,
          ...(identity && identity.dkimTokens.length > 0 && JSON.stringify(identity.dkimTokens) !== JSON.stringify(base.dkimTokens)
            ? { dkimTokens: identity.dkimTokens as Prisma.InputJsonValue }
            : {}),
          ...(verificationStatus !== domain.sesVerificationStatus ? { sesVerificationStatus: verificationStatus } : {}),
          // M3d: the first time SPF, DKIM and DMARC are all valid starts the warm-up plan (marketing_settings.email_warmup_plan).
          ...(!domain.warmupStartedAt && dns.spfStatus === 'VALID' && dkimStatus === 'VALID' && dns.dmarcStatus === 'VALID' ? { warmupStartedAt: new Date() } : {}),
        },
      });
      if (audit) await audit(tx, { spf: dns.spfStatus, dkim: dkimStatus, dmarc: dns.dmarcStatus, source: dkimFromSes ? 'SES' : 'DNS' });
      return updated;
    });
    const changed =
      row.spfStatus !== domain.spfStatus || row.dkimStatus !== domain.dkimStatus || row.dmarcStatus !== domain.dmarcStatus || row.sesVerificationStatus !== domain.sesVerificationStatus;
    return { row, records, changed };
  }

  /** Creates or fetches the SES identity with Easy DKIM, stores the tokens and returns the records to publish. Super admin only (the controller). */
  async provision(studioId: string, userId: string, id: string): Promise<SesProvisionResultDTO> {
    const domain = await this.prisma.emailSenderDomain.findFirst({ where: { id, studioId } });
    if (!domain) throw new NotFoundException(apiError('apiErrors.common.domainNotFound'));
    if (this.ses.provider === 'MOCK' && this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException(apiError('apiErrors.platformMarketing.emailProviderSesNotConfigured'));
    }

    let created: boolean;
    let info: SesIdentityInfo;
    try {
      ({ created, info } = await this.ses.ensureIdentity(domain.domain, domain.mailFromDomain));
    } catch (err) {
      this.logger.warn(`SES identity provisioning failed for ${domain.domain}: ${err instanceof Error ? err.name : 'unknown'}`);
      throw new BadGatewayException(apiError('apiErrors.platformMarketing.sesIdentityCouldNotSetUp'));
    }
    if (info.dkimTokens.length === 0) throw new BadGatewayException(apiError('apiErrors.platformMarketing.sesNotGeneratedDkimKeysYet'));

    const live = this.ses.provider === 'SES';
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.emailSenderDomain.update({
        where: { id: domain.id },
        data: {
          dkimTokens: info.dkimTokens as Prisma.InputJsonValue,
          sesProvisionedAt: new Date(),
          sesVerificationStatus: info.verificationStatus,
          ...(live ? { dkimStatus: dnsStatusFromSesDkim(info.dkimStatus) } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          studioId,
          userId,
          action: 'marketing.sender_domain.ses_provisioned',
          entityType: 'EmailSenderDomain',
          entityId: domain.id,
          metadata: { domain: domain.domain, provider: this.ses.provider, created, tokens: info.dkimTokens.length, verification: info.verificationStatus } as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    const dto = toEmailDomainDto(row, this.sesRegion());
    return { provider: this.ses.provider, created, domain: dto, records: dto.expectedRecords };
  }

  /**
   * Heartbeat step: re-checks the platform tenant's sender domains that are
   * due (never checked, not fully verified for an hour, or verified for a
   * day). SES credentials configured: DKIM and verification come from SES;
   * otherwise it is the DNS-only check. A change is written to the audit log.
   */
  async processDue(now: Date): Promise<EmailDomainHeartbeatResult> {
    const studio = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!studio) return { checked: 0, failed: 0 };
    const domains = await this.prisma.emailSenderDomain.findMany({ where: { studioId: studio.id }, orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } } });
    const due = domains
      .filter((d) => {
        if (!d.lastCheckedAt) return true;
        const verified = d.spfStatus === 'VALID' && d.dkimStatus === 'VALID' && d.dmarcStatus === 'VALID';
        return now.getTime() - d.lastCheckedAt.getTime() >= (verified ? VERIFIED_RECHECK_MS : UNVERIFIED_RECHECK_MS);
      })
      .slice(0, HEARTBEAT_BATCH);
    let checked = 0;
    let failed = 0;
    for (const domain of due) {
      try {
        const outcome = await this.check(domain, undefined);
        checked += 1;
        if (outcome.changed) {
          await this.prisma.auditLog.create({
            data: {
              studioId: studio.id,
              userId: null,
              action: 'integration.email_domain.check',
              entityType: 'integration',
              entityId: domain.id,
              metadata: { spf: outcome.row.spfStatus, dkim: outcome.row.dkimStatus, dmarc: outcome.row.dmarcStatus, sesVerification: outcome.row.sesVerificationStatus, via: 'heartbeat' } as Prisma.InputJsonValue,
            },
          });
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(`Sender domain check failed for ${domain.id}: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    return { checked, failed };
  }
}
