import type { DnsRecordStatus, ExpectedDnsRecordDTO } from '@platform/shared';

/**
 * Pure evaluation of an email sender domain's DNS against what Amazon SES
 * needs (docs/PAZARLAMA_MODULU.md 5.2): SPF on the MAIL FROM domain (or the
 * domain itself), the three Easy DKIM CNAMEs, and a DMARC policy. The
 * resolver is injected so tests run without a network.
 */
export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
}

export interface EmailDomainDnsConfig {
  domain: string;
  mailFromDomain: string | null;
  dkimTokens: readonly string[];
  /** SES region for the MAIL FROM MX record; null shows a placeholder. */
  sesRegion: string | null;
}

export interface EmailDomainDnsResult {
  spfStatus: DnsRecordStatus;
  dkimStatus: DnsRecordStatus;
  dmarcStatus: DnsRecordStatus;
  dmarcPolicy: string | null;
  records: ExpectedDnsRecordDTO[];
  /** A lookup failed for a reason other than "no such record" (timeout, SERVFAIL). */
  error: string | null;
}

const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);
const DMARC_POLICIES = new Set(['none', 'quarantine', 'reject']);

const stripDot = (v: string) => v.replace(/\.$/, '').toLowerCase();

/** The records to publish, before any lookup: every status PENDING. */
export function expectedEmailDomainRecords(cfg: EmailDomainDnsConfig): ExpectedDnsRecordDTO[] {
  const spfHost = cfg.mailFromDomain ?? cfg.domain;
  const records: ExpectedDnsRecordDTO[] = [
    { kind: 'SPF', type: 'TXT', name: spfHost, value: 'v=spf1 include:amazonses.com ~all', status: 'PENDING' },
    ...cfg.dkimTokens.map(
      (token): ExpectedDnsRecordDTO => ({
        kind: 'DKIM',
        type: 'CNAME',
        name: `${token}._domainkey.${cfg.domain}`,
        value: `${token}.dkim.amazonses.com`,
        status: 'PENDING',
      }),
    ),
    { kind: 'DMARC', type: 'TXT', name: `_dmarc.${cfg.domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc@${cfg.domain}`, status: 'PENDING' },
  ];
  if (cfg.mailFromDomain) {
    records.push({
      kind: 'MAIL_FROM_MX',
      type: 'MX',
      name: cfg.mailFromDomain,
      value: `10 feedback-smtp.${cfg.sesRegion ?? '<region>'}.amazonses.com`,
      status: 'PENDING',
    });
  }
  return records;
}

export async function checkEmailDomainDns(cfg: EmailDomainDnsConfig, dns: DnsLookup): Promise<EmailDomainDnsResult> {
  const errors: string[] = [];
  async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (!code || !NOT_FOUND_CODES.has(code)) errors.push(code ?? (err as Error).message);
      return [];
    }
  }

  const records = expectedEmailDomainRecords(cfg);
  const spfHost = cfg.mailFromDomain ?? cfg.domain;

  // SPF: exactly the v=spf1 records; VALID when one authorizes SES.
  const spfTxt = (await safe(() => dns.resolveTxt(spfHost))).map((chunks) => chunks.join('')).filter((t) => /^v=spf1\b/i.test(t.trim()));
  const spfStatus: DnsRecordStatus =
    spfTxt.length === 0 ? 'MISSING' : spfTxt.some((t) => /\binclude:amazonses\.com\b/i.test(t)) ? 'VALID' : 'INVALID';

  // DKIM: every token's CNAME must point at <token>.dkim.amazonses.com.
  const dkimStatuses: DnsRecordStatus[] = [];
  for (const token of cfg.dkimTokens) {
    const targets = (await safe(() => dns.resolveCname(`${token}._domainkey.${cfg.domain}`))).map(stripDot);
    dkimStatuses.push(targets.length === 0 ? 'MISSING' : targets.includes(`${token}.dkim.amazonses.com`) ? 'VALID' : 'INVALID');
  }
  const dkimStatus: DnsRecordStatus =
    dkimStatuses.length === 0 || dkimStatuses.every((s) => s === 'MISSING')
      ? 'MISSING'
      : dkimStatuses.every((s) => s === 'VALID')
        ? 'VALID'
        : 'INVALID';

  // DMARC: a v=DMARC1 record with a known p= policy.
  const dmarcTxt = (await safe(() => dns.resolveTxt(`_dmarc.${cfg.domain}`)))
    .map((chunks) => chunks.join(''))
    .filter((t) => /^v=DMARC1\b/i.test(t.trim()));
  let dmarcPolicy: string | null = null;
  let dmarcStatus: DnsRecordStatus = 'MISSING';
  if (dmarcTxt.length > 0) {
    const match = /(?:^|;)\s*p\s*=\s*([a-z]+)/i.exec(dmarcTxt[0]);
    dmarcPolicy = match ? match[1].toLowerCase() : null;
    dmarcStatus = dmarcPolicy && DMARC_POLICIES.has(dmarcPolicy) ? 'VALID' : 'INVALID';
  }

  let mxStatus: DnsRecordStatus | null = null;
  if (cfg.mailFromDomain) {
    const mx = await safe(() => dns.resolveMx(cfg.mailFromDomain as string));
    mxStatus = mx.length === 0 ? 'MISSING' : mx.some((r) => stripDot(r.exchange).endsWith('.amazonses.com')) ? 'VALID' : 'INVALID';
  }

  let dkimIndex = 0;
  for (const record of records) {
    if (record.kind === 'SPF') record.status = spfStatus;
    else if (record.kind === 'DKIM') record.status = dkimStatuses[dkimIndex++] ?? 'MISSING';
    else if (record.kind === 'DMARC') record.status = dmarcStatus;
    else if (record.kind === 'MAIL_FROM_MX' && mxStatus) record.status = mxStatus;
  }

  return {
    spfStatus,
    dkimStatus,
    dmarcStatus,
    dmarcPolicy,
    records,
    error: errors.length > 0 ? `DNS: ${[...new Set(errors)].join(', ')}`.slice(0, 500) : null,
  };
}
