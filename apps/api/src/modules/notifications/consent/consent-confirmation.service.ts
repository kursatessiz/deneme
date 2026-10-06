import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import { CONSENT_CONFIRMATION_TEMPLATE_KEY, CONSENT_CONFIRMATION_TTL_DAYS } from '@platform/shared';
import type { ConsentConfirmationErrorCode, ConsentConfirmResultDTO, ConsentResendResultDTO, ContactConsentChannel } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../../messaging/engine/messaging.service';
import { ContactConsentService } from './contact-consent.service';
import {
  confirmationExpiresAt,
  hashConfirmationToken,
  isConfirmationUsable,
  isWellFormedConfirmationToken,
  newConfirmationToken,
  resendAllowed,
  resendWindowStart,
} from './consent-confirmation.tokens';
import { apiError, codedError } from '../../../common/api-error';

function confirmationError(status: HttpStatus, code: ConsentConfirmationErrorCode): HttpException {
  return new HttpException(codedError(code, { statusCode: status }), status);
}

/**
 * Double opt-in (M3e, docs/PAZARLAMA_MODULU.md 6.4). A form consent in a
 * double opt-in region gets a confirmation e-mail (transactional template
 * CONSENT_CONFIRMATION, tr + en) whose link carries an opaque single-use
 * token; only its SHA-256 is stored and it expires after 7 days. Clicking
 * it sets confirmedAt on the pending consents of the contact; no IP
 * address or device is recorded, only the time (the form version is on
 * the consent row). A contact gets at most 3 confirmation e-mails in a
 * rolling day, the first one included.
 */
@Injectable()
export class ConsentConfirmationService {
  private readonly logger = new Logger(ConsentConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly consents: ContactConsentService,
    private readonly messaging: MessagingService,
  ) {}

  /**
   * Records a web form's marketing consent and, when it now waits for a
   * double opt-in, sends the confirmation e-mail (skipped quietly without
   * an e-mail address or over the daily limit; the resend button remains).
   */
  async afterFormConsent(
    studioId: string,
    contactId: string,
    input: { channels: readonly ContactConsentChannel[]; formVersion: string | null; countryCode: string | null; locale: string | null },
  ): Promise<{ pending: boolean; sent: boolean }> {
    const { pendingConsentIds } = await this.consents.recordFormConsent(studioId, contactId, input);
    if (!pendingConsentIds.length) return { pending: false, sent: false };
    const sentInWindow = await this.sentInWindow(studioId, contactId, new Date());
    if (!resendAllowed(sentInWindow)) return { pending: true, sent: false };
    const sent = await this.issue(studioId, contactId, pendingConsentIds[0]!, input.locale);
    return { pending: true, sent };
  }

  /** POST /public/consent/confirm/:token. Neutral: an unknown, used or expired token all read INVALID. */
  async confirm(token: string, now = new Date()): Promise<ConsentConfirmResultDTO> {
    if (!isWellFormedConfirmationToken(token)) return { result: 'INVALID' };
    const row = await this.prisma.contactConsentConfirmation.findUnique({
      where: { tokenHash: hashConfirmationToken(token) },
      include: { contactConsent: { select: { contactId: true } } },
    });
    if (!row || !isConfirmationUsable(row, now)) return { result: 'INVALID' };
    const contactId = row.contactConsent.contactId;
    const confirmed = await this.prisma.$transaction(async (tx) => {
      // Single use even under a double click: only the first update wins.
      const claimed = await tx.contactConsentConfirmation.updateMany({ where: { id: row.id, confirmedAt: null, expiresAt: { gt: now } }, data: { confirmedAt: now } });
      if (claimed.count !== 1) return false;
      await this.consents.markConfirmed(row.studioId, contactId, now, tx);
      return true;
    });
    if (!confirmed) return { result: 'INVALID' };
    await this.consents.syncContact(row.studioId, contactId);
    return { result: 'CONFIRMED' };
  }

  /** POST /platform/marketing/contacts/:id/resend-confirmation (platform.marketing.manage). */
  async resend(studioId: string, contactId: string, actorUserId: string, now = new Date()): Promise<ConsentResendResultDTO> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, studioId, mergedIntoId: null },
      select: { id: true, email: true, locale: true, membership: { select: { user: { select: { email: true } } } } },
    });
    if (!contact) throw new NotFoundException(apiError('apiErrors.common.contactNotFound'));
    const pending = await this.prisma.contactConsent.findFirst({
      where: { studioId, contactId, status: 'GRANTED', confirmationRequestedAt: { not: null }, confirmedAt: null },
      orderBy: { channel: 'asc' },
      select: { id: true },
    });
    if (!pending) throw confirmationError(HttpStatus.CONFLICT, 'CONSENT_CONFIRMATION_NOT_PENDING');
    if (!(contact.email ?? contact.membership?.user.email)) {
      throw confirmationError(HttpStatus.CONFLICT, 'CONSENT_CONFIRMATION_NO_EMAIL');
    }
    const sentInWindow = await this.sentInWindow(studioId, contactId, now);
    if (!resendAllowed(sentInWindow)) {
      throw confirmationError(HttpStatus.TOO_MANY_REQUESTS, 'CONSENT_CONFIRMATION_RATE_LIMITED');
    }
    const sent = await this.issue(studioId, contactId, pending.id, contact.locale, now);
    await this.prisma.auditLog.create({
      data: {
        studioId,
        userId: actorUserId,
        action: 'marketing.consent.confirmation_resent',
        entityType: 'Contact',
        entityId: contactId,
        metadata: { sent, sentInWindow: sentInWindow + 1 } as Prisma.InputJsonValue,
      },
    });
    return { sent, sentToday: sentInWindow + 1 };
  }

  private sentInWindow(studioId: string, contactId: string, now: Date): Promise<number> {
    return this.prisma.contactConsentConfirmation.count({
      where: { studioId, contactConsent: { contactId }, createdAt: { gt: resendWindowStart(now) } },
    });
  }

  /** Creates a token, stores its hash and sends the e-mail. The confirmation row counts toward the limit even if delivery fails. */
  private async issue(studioId: string, contactId: string, contactConsentId: string, locale: string | null, now = new Date()): Promise<boolean> {
    const token = newConfirmationToken();
    const consent = await this.prisma.contactConsent.findUniqueOrThrow({ where: { id: contactConsentId }, select: { formVersion: true } });
    await this.prisma.contactConsentConfirmation.create({
      data: { studioId, contactConsentId, tokenHash: hashConfirmationToken(token), expiresAt: confirmationExpiresAt(now) },
    });
    await this.prisma.contactActivity.create({
      data: {
        studioId,
        contactId,
        type: 'CONSENT',
        body: 'EMAIL CONFIRMATION_REQUESTED CONSENT',
        metadata: { event: 'confirmation_email_requested', formVersion: consent.formVersion },
      },
    });
    const result = await this.messaging
      .send({
        studioId,
        recipient: { contactId },
        channel: 'EMAIL',
        purpose: 'TRANSACTIONAL',
        templateKey: CONSENT_CONFIRMATION_TEMPLATE_KEY,
        type: CONSENT_CONFIRMATION_TEMPLATE_KEY,
        locale,
        variables: { formVersion: consent.formVersion ?? '-', days: CONSENT_CONFIRMATION_TTL_DAYS, link: this.confirmUrl(token) },
        // The link is a credential: never written to logs or the database.
        sensitive: true,
      })
      .catch((err: Error) => {
        this.logger.warn(`Consent confirmation e-mail failed: ${err.message}`);
        return { success: false };
      });
    return result.success;
  }

  private confirmUrl(token: string): string {
    const base = this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/onay/${token}`;
  }
}

