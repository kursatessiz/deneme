import { checkEmailDomainDns, expectedEmailDomainRecords, type DnsLookup } from './email-domain-dns';

function notFound(): Error {
  return Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });
}

/** In-memory resolver: unknown names behave like NXDOMAIN. */
function fakeDns(zone: { txt?: Record<string, string[][]>; cname?: Record<string, string[]>; mx?: Record<string, { exchange: string; priority: number }[]> }): DnsLookup {
  return {
    resolveTxt: async (name) => {
      if (zone.txt?.[name]) return zone.txt[name];
      throw notFound();
    },
    resolveCname: async (name) => {
      if (zone.cname?.[name]) return zone.cname[name];
      throw notFound();
    },
    resolveMx: async (name) => {
      if (zone.mx?.[name]) return zone.mx[name];
      throw notFound();
    },
  };
}

const TOKENS = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccc'];
const cfg = { domain: 'news.example.com', mailFromDomain: 'mail.news.example.com', dkimTokens: TOKENS, sesRegion: 'eu-central-1' };

describe('email sender domain DNS check', () => {
  it('lists the records to publish, with the SPF on the MAIL FROM domain and an MX for it', () => {
    const records = expectedEmailDomainRecords(cfg);
    expect(records.map((r) => `${r.kind} ${r.type} ${r.name}`)).toEqual([
      'SPF TXT mail.news.example.com',
      `DKIM CNAME ${TOKENS[0]}._domainkey.news.example.com`,
      `DKIM CNAME ${TOKENS[1]}._domainkey.news.example.com`,
      `DKIM CNAME ${TOKENS[2]}._domainkey.news.example.com`,
      'DMARC TXT _dmarc.news.example.com',
      'MAIL_FROM_MX MX mail.news.example.com',
    ]);
    expect(records.find((r) => r.kind === 'MAIL_FROM_MX')?.value).toBe('10 feedback-smtp.eu-central-1.amazonses.com');
    expect(records.every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('marks everything VALID when the zone is complete (split TXT chunks, trailing dots)', async () => {
    const dns = fakeDns({
      txt: {
        'mail.news.example.com': [['v=spf1 include:amazon', 'ses.com ~all']],
        '_dmarc.news.example.com': [['v=DMARC1; p=quarantine; rua=mailto:d@example.com']],
      },
      cname: Object.fromEntries(TOKENS.map((t) => [`${t}._domainkey.news.example.com`, [`${t}.dkim.amazonses.com.`]])),
      mx: { 'mail.news.example.com': [{ exchange: 'feedback-smtp.eu-central-1.amazonses.com', priority: 10 }] },
    });
    const result = await checkEmailDomainDns(cfg, dns);
    expect(result).toMatchObject({ spfStatus: 'VALID', dkimStatus: 'VALID', dmarcStatus: 'VALID', dmarcPolicy: 'quarantine', error: null });
    expect(result.records.every((r) => r.status === 'VALID')).toBe(true);
  });

  it('reports MISSING for an empty zone and INVALID for wrong values', async () => {
    const empty = await checkEmailDomainDns(cfg, fakeDns({}));
    expect(empty).toMatchObject({ spfStatus: 'MISSING', dkimStatus: 'MISSING', dmarcStatus: 'MISSING', dmarcPolicy: null, error: null });

    const wrong = await checkEmailDomainDns(
      cfg,
      fakeDns({
        txt: {
          'mail.news.example.com': [['v=spf1 include:_spf.google.com ~all'], ['google-site-verification=x']],
          '_dmarc.news.example.com': [['v=DMARC1; p=bogus']],
        },
        cname: { [`${TOKENS[0]}._domainkey.news.example.com`]: [`${TOKENS[0]}.dkim.amazonses.com`], [`${TOKENS[1]}._domainkey.news.example.com`]: ['elsewhere.example.net'] },
      }),
    );
    expect(wrong).toMatchObject({ spfStatus: 'INVALID', dkimStatus: 'INVALID', dmarcStatus: 'INVALID', dmarcPolicy: 'bogus' });
    expect(wrong.records.filter((r) => r.kind === 'DKIM').map((r) => r.status)).toEqual(['VALID', 'INVALID', 'MISSING']);
  });

  it('without DKIM tokens DKIM is MISSING; the SPF sits on the domain when there is no MAIL FROM', async () => {
    const result = await checkEmailDomainDns(
      { domain: 'example.org', mailFromDomain: null, dkimTokens: [], sesRegion: null },
      fakeDns({ txt: { 'example.org': [['v=spf1 include:amazonses.com -all']] } }),
    );
    expect(result.spfStatus).toBe('VALID');
    expect(result.dkimStatus).toBe('MISSING');
    expect(result.records.some((r) => r.kind === 'MAIL_FROM_MX')).toBe(false);
  });

  it('surfaces resolver failures other than "not found" as an error', async () => {
    const dns = fakeDns({});
    dns.resolveTxt = async () => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
    };
    const result = await checkEmailDomainDns(cfg, dns);
    expect(result.error).toContain('ETIMEOUT');
  });
});
