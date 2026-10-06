import { Logger } from '@nestjs/common';
import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { mockDkimTokens, parseSesIdentityStatus } from '@platform/shared';
import type { SesIdentityStatus, SesProvisionProvider } from '@platform/shared';

/** What SES reports about a domain identity (only the fields the platform stores). */
export interface SesIdentityInfo {
  /** Easy DKIM tokens (three CNAME labels). */
  dkimTokens: string[];
  dkimStatus: SesIdentityStatus | null;
  verificationStatus: SesIdentityStatus | null;
}

export interface SesEnsureResult {
  /** True when the identity was created by this call, false when it already existed. */
  created: boolean;
  info: SesIdentityInfo;
}

/**
 * The SES identity API the sender domain automation needs (M5). The real
 * client talks to Amazon SES v2 with the credentials of the SDK's default
 * provider chain; the mock answers deterministically without a network, so
 * local development and the e2e suite never call AWS. The e2e suite replaces
 * the provider with a stateful fake to drive DKIM through its statuses.
 */
export interface SesIdentityPort {
  readonly provider: SesProvisionProvider;
  /** Creates the domain identity with Easy DKIM, or fetches it when it already exists. */
  ensureIdentity(domain: string, mailFromDomain: string | null): Promise<SesEnsureResult>;
  /** Reads the identity; null when SES does not know the domain. */
  getIdentity(domain: string): Promise<SesIdentityInfo | null>;
}

export const SES_IDENTITY_PORT = Symbol('SES_IDENTITY_PORT');

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'NotFoundException';
}

/** Amazon SES v2 (Easy DKIM). Region from SES_REGION; credentials from the default provider chain, never from code. */
export class AwsSesIdentityClient implements SesIdentityPort {
  readonly provider = 'SES' as const;
  private readonly logger = new Logger(AwsSesIdentityClient.name);
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly configurationSet?: string,
  ) {
    this.client = new SESv2Client({ region });
  }

  async ensureIdentity(domain: string, mailFromDomain: string | null): Promise<SesEnsureResult> {
    const existing = await this.getIdentity(domain);
    let created = false;
    if (!existing) {
      await this.client.send(new CreateEmailIdentityCommand({ EmailIdentity: domain, ConfigurationSetName: this.configurationSet || undefined }));
      created = true;
    }
    if (mailFromDomain) {
      try {
        await this.client.send(
          new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: domain, MailFromDomain: mailFromDomain, BehaviorOnMxFailure: 'USE_DEFAULT_VALUE' }),
        );
      } catch (err) {
        // The DKIM tokens are what the caller needs; a MAIL FROM problem is shown by the domain check, not fatal here.
        this.logger.warn(`SES MAIL FROM setup failed for ${domain}: ${err instanceof Error ? err.name : 'unknown'}`);
      }
    }
    const info = await this.getIdentity(domain);
    if (!info) throw new Error('SES identity could not be read after it was created');
    return { created, info };
  }

  async getIdentity(domain: string): Promise<SesIdentityInfo | null> {
    try {
      const res = await this.client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      return {
        dkimTokens: (res.DkimAttributes?.Tokens ?? []).map((t) => t.toLowerCase()),
        dkimStatus: parseSesIdentityStatus(res.DkimAttributes?.Status),
        verificationStatus: parseSesIdentityStatus(res.VerificationStatus) ?? (res.VerifiedForSendingStatus ? 'SUCCESS' : 'PENDING'),
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

/** Deterministic stand-in used without SES credentials (development, tests): fake tokens, statuses that never reach SUCCESS. */
export class MockSesIdentityClient implements SesIdentityPort {
  readonly provider = 'MOCK' as const;
  private readonly known = new Set<string>();

  async ensureIdentity(domain: string): Promise<SesEnsureResult> {
    const created = !this.known.has(domain);
    this.known.add(domain);
    return { created, info: { dkimTokens: mockDkimTokens(domain), dkimStatus: 'PENDING', verificationStatus: 'PENDING' } };
  }

  async getIdentity(domain: string): Promise<SesIdentityInfo | null> {
    if (!this.known.has(domain)) return null;
    return { dkimTokens: mockDkimTokens(domain), dkimStatus: 'PENDING', verificationStatus: 'PENDING' };
  }
}
