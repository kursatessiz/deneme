import { Injectable, Logger } from '@nestjs/common';
import { resolveTxt, resolveCname } from 'dns/promises';

/**
 * Real DNS verification for custom domains, isolated behind an interface so
 * tests can stub it. A domain verifies once BOTH records resolve: a TXT
 * record proving control and a CNAME pointing at the platform.
 */
@Injectable()
export class DnsVerificationService {
  private readonly logger = new Logger(DnsVerificationService.name);

  async verify(domain: string, expectedToken: string, expectedCnameTarget: string): Promise<boolean> {
    try {
      const [txtRecords, cnameRecords] = await Promise.all([
        resolveTxt(`_platform-verify.${domain}`).catch((): string[][] => []),
        resolveCname(domain).catch((): string[] => []),
      ]);
      const txtOk = txtRecords.some((chunks) => chunks.join('') === expectedToken);
      const cnameOk = cnameRecords.some((c) => c.replace(/\.$/, '') === expectedCnameTarget.replace(/\.$/, ''));
      return txtOk && cnameOk;
    } catch (err) {
      this.logger.warn(`DNS verification failed for ${domain}: ${(err as Error).message}`);
      return false;
    }
  }
}
