import { CreateEmailSenderDomainSchema } from '../integrations-hub';
import { dnsStatusFromSesDkim, mockDkimTokens, parseSesIdentityStatus } from './ses-identity';

describe('SES identity helpers', () => {
  it('maps the SES DKIM status to the record status a domain shows', () => {
    expect(dnsStatusFromSesDkim('SUCCESS')).toBe('VALID');
    expect(dnsStatusFromSesDkim('FAILED')).toBe('INVALID');
    expect(dnsStatusFromSesDkim('PENDING')).toBe('MISSING');
    expect(dnsStatusFromSesDkim('NOT_STARTED')).toBe('MISSING');
    expect(dnsStatusFromSesDkim('TEMPORARY_FAILURE')).toBe('PENDING');
    expect(dnsStatusFromSesDkim(null)).toBe('PENDING');
  });

  it('parses only known SES statuses', () => {
    expect(parseSesIdentityStatus('success')).toBe('SUCCESS');
    expect(parseSesIdentityStatus('PENDING')).toBe('PENDING');
    expect(parseSesIdentityStatus('WHATEVER')).toBeNull();
    expect(parseSesIdentityStatus(undefined)).toBeNull();
  });

  it('makes deterministic mock tokens that a sender domain accepts', () => {
    const tokens = mockDkimTokens('news.example.com');
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
    expect(mockDkimTokens('news.example.com')).toEqual(tokens);
    expect(mockDkimTokens('NEWS.example.com')).toEqual(tokens);
    expect(mockDkimTokens('other.example.com')).not.toEqual(tokens);
    expect(CreateEmailSenderDomainSchema.safeParse({ domain: 'news.example.com', dkimTokens: tokens }).success).toBe(true);
  });
});
