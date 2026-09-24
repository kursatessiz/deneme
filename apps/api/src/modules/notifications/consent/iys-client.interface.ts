export type IysChannel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'CALL';
export type IysConsentType = 'GRANTED' | 'REVOKED';

export interface IysSyncRequest {
  /** E.164 phone or email address, depending on channel. */
  recipient: string;
  channel: IysChannel;
  type: IysConsentType;
  /** ISO timestamp of the consent/revocation event. */
  at: string;
}

export interface IysSyncResult {
  success: boolean;
  transactionId?: string;
  errorMessage?: string;
}

/**
 * İYS (İleti Yönetim Sistemi) is the Turkish government-mandated registry
 * for commercial-message consent. Every GRANTED/REVOKED change for a
 * commercial channel must eventually reach it under the brand's code.
 */
export interface IysClient {
  syncConsent(request: IysSyncRequest): Promise<IysSyncResult>;
}
