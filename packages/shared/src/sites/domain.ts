/**
 * Custom domain verification for tenant sites (docs/SAYFA_MOTORU.md
 * section "Alan adları"). A domain is verified once BOTH checks pass:
 * a DNS TXT record at `_platform-verify.<domain>` equal to the token, and a
 * CNAME (or A, for an apex domain) pointing the domain at the platform.
 * The actual DNS lookups happen in the API (this module is DNS-free and
 * unit testable); it only shapes the expected records and validates a
 * candidate domain string.
 */

export interface ExpectedDnsRecords {
  txtHost: string;
  txtValue: string;
  cnameHost: string;
  cnameValue: string;
}

export function expectedDnsRecords(domain: string, verificationToken: string, platformCnameTarget: string): ExpectedDnsRecords {
  return {
    txtHost: `_platform-verify.${domain}`,
    txtValue: verificationToken,
    cnameHost: domain,
    cnameValue: platformCnameTarget,
  };
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain.trim().toLowerCase()) && domain.length <= 190;
}
