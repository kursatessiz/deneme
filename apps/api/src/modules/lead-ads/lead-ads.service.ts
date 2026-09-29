import { createHash } from 'crypto';
import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import {
  LEAD_AD_CONVERSION_SOURCE_KIND,
  LEAD_AD_SOURCE_CHANNEL,
  LEAD_AD_UTM_MEDIUM,
  LEAD_AD_UTM_SOURCE,
  LeadAdFieldMappingSchema,
  countryOfPhone,
  mapLeadFields,
  nextLeadAdAttemptAt,
  normalizePhone,
  parseLeadgenNotifications,
  resolveLeadName,
} from '@platform/shared';
import type { ContactConsentChannel, LeadAdEventStatus, LeadgenNotification, MappedLead, MetaCredentials } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipher } from '../../common/crypto/credential-cipher';
import { ContactsService } from '../crm/contacts/contacts.service';
import { AttributionService } from '../crm/attribution/attribution.service';
import { ConversionService } from '../crm/conversions/conversion.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ConsentConfirmationService } from '../notifications/consent/consent-confirmation.service';
import { verifyMetaSignature } from '../messaging/webhooks/whatsapp-signature';
import { META_GRAPH_CLIENT } from './meta-graph.client';
import type { MetaGraphClient } from './meta-graph.client';

/** While an event is being processed its nextAttemptAt is pushed this far, so a parallel run skips it. */
const LEASE_MS = 10 * 60 * 1000;
/** Most notifications one request processes inline; the rest wait for the heartbeat. */
const INLINE_LIMIT = 25;
const DUE_BATCH = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A stable UUID derived from a seed: the same lead always gets the same visitor and session id. */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface IntakeResult {
  received: number;
  duplicates: number;
  processed: number;
}

export interface DueResult {
  processed: number;
  retrying: number;
  failed: number;
}

type ProcessOutcome = 'PROCESSED' | 'RETRY' | 'FAILED' | 'SKIPPED';

/**
 * Meta Lead Ads intake (M4c, docs/PAZARLAMA_MODULU.md 5.2). A signed
 * `leadgen` notification is routed to its AdConnection by page id and
 * verified against that connection's stored app secret; every change gets
 * one lead_ad_events row (unique per studio and leadgen id, so a
 * re-delivery is ignored) and is then fetched from the Graph API with the
 * connection's token, mapped to a Contact through the form's stored
 * mapping, credited with a `lead` conversion and a touchpoint carrying the
 * campaign, ad set and ad ids, and, only when the form has a consent
 * question that was ticked, given marketing consent under the M3e rules
 * (form version = form id, double opt-in in the configured regions). A
 * transient failure schedules a retry on the heartbeat.
 */
@Injectable()
export class LeadAdsService {
  private readonly logger = new Logger(LeadAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    @Inject(META_GRAPH_CLIENT) private readonly graph: MetaGraphClient,
    private readonly contacts: ContactsService,
    private readonly attribution: AttributionService,
    private readonly conversions: ConversionService,
    private readonly webhooks: WebhooksService,
    @Optional() private readonly consentConfirmations?: ConsentConfirmationService,
  ) {}

  // -------------------------------------------------------------------------
  // Webhook entry
  // -------------------------------------------------------------------------

  /**
   * Handles one POST of the leadgen webhook. Throws 401 when the signature
   * is missing or malformed, or when no notification in the body belongs to
   * a connection whose app secret verifies it. Notifications of pages we
   * have no connection for are skipped, never an error (Meta may notify the
   * app about more pages than a tenant connected).
   */
  async receive(rawBody: Buffer, signatureHeader: string | undefined, now = new Date()): Promise<IntakeResult> {
    if (!signatureHeader || !/^sha256=[0-9a-f]{64}$/i.test(signatureHeader.trim())) throw new UnauthorizedException();
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new UnauthorizedException();
    }
    const notifications = parseLeadgenNotifications(body);
    if (notifications.length === 0) return { received: 0, duplicates: 0, processed: 0 };

    const verifiedPages = new Map<string, { id: string; studioId: string }>();
    for (const pageId of new Set(notifications.map((n) => n.pageId))) {
      const connection = await this.prisma.adConnection.findFirst({
        where: { leadAdsPageId: pageId, platform: 'META', status: { not: 'DISCONNECTED' } },
        select: { id: true, studioId: true, encryptedCredentials: true },
      });
      if (!connection) continue;
      const secret = this.appSecretOf(connection.encryptedCredentials);
      if (secret && verifyMetaSignature(rawBody, signatureHeader, secret)) verifiedPages.set(pageId, { id: connection.id, studioId: connection.studioId });
    }
    if (verifiedPages.size === 0) {
      this.logger.warn('Rejected leadgen webhook: no connection verified the signature');
      throw new UnauthorizedException();
    }

    const result: IntakeResult = { received: 0, duplicates: 0, processed: 0 };
    const toProcess: string[] = [];
    for (const note of notifications) {
      const connection = verifiedPages.get(note.pageId);
      if (!connection) continue;
      const created = await this.recordNotification(connection.studioId, connection.id, note);
      if (!created) {
        result.duplicates += 1;
        continue;
      }
      result.received += 1;
      toProcess.push(created);
    }
    for (const id of toProcess.slice(0, INLINE_LIMIT)) {
      if ((await this.processEvent(id, now)) === 'PROCESSED') result.processed += 1;
    }
    return result;
  }

  /** Inserts the idempotency row; null when this lead was already received (the re-delivery is ignored). */
  private async recordNotification(studioId: string, connectionId: string, note: LeadgenNotification): Promise<string | null> {
    try {
      const row = await this.prisma.leadAdEvent.create({
        data: {
          studioId,
          connectionId,
          leadgenId: note.leadgenId,
          formId: note.formId,
          pageId: note.pageId,
          adIds: (note.adId ? { adId: note.adId } : {}) as Prisma.InputJsonValue,
          createdTime: note.createdTime,
          status: 'PENDING',
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  /** Processes events waiting for their first try or a retry (called by the scheduler heartbeat). */
  async processDue(now = new Date()): Promise<DueResult> {
    const due = await this.prisma.leadAdEvent.findMany({
      where: { status: { in: ['PENDING', 'RETRY'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { receivedAt: 'asc' },
      take: DUE_BATCH,
      select: { id: true },
    });
    const out: DueResult = { processed: 0, retrying: 0, failed: 0 };
    for (const { id } of due) {
      const outcome = await this.processEvent(id, now);
      if (outcome === 'PROCESSED') out.processed += 1;
      else if (outcome === 'RETRY') out.retrying += 1;
      else if (outcome === 'FAILED') out.failed += 1;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // One event
  // -------------------------------------------------------------------------

  async processEvent(eventId: string, now = new Date()): Promise<ProcessOutcome> {
    const claimed = await this.prisma.leadAdEvent.updateMany({
      where: { id: eventId, status: { in: ['PENDING', 'RETRY'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count !== 1) return 'SKIPPED';
    const event = await this.prisma.leadAdEvent.findUniqueOrThrow({ where: { id: eventId } });

    try {
      const connection = event.connectionId ? await this.prisma.adConnection.findFirst({ where: { id: event.connectionId, studioId: event.studioId } }) : null;
      if (!connection || connection.status === 'DISCONNECTED') return await this.settle(event.id, event.attempts, now, { transient: false, message: 'The Lead Ads connection is gone or disconnected' });
      const credentials = this.credentialsOf(connection.encryptedCredentials);
      if (!credentials) return await this.settle(event.id, event.attempts, now, { transient: false, message: 'The connection credentials could not be read' });

      const fetched = await this.graph.fetchLead(credentials.accessToken, event.leadgenId);
      if (!fetched.ok) return await this.settle(event.id, event.attempts, now, { transient: fetched.transient, message: fetched.message });

      const mappingRow = await this.prisma.leadAdFormMapping.findUnique({ where: { studioId_formId: { studioId: event.studioId, formId: event.formId } } });
      const parsedMapping = mappingRow ? LeadAdFieldMappingSchema.safeParse(mappingRow.mapping) : null;
      const mapped = mapLeadFields(fetched.lead.field_data, parsedMapping?.success ? parsedMapping.data : null, mappingRow?.consentQuestionKey ?? null);

      const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: event.studioId }, select: { countryCode: true } });
      const phone = mapped.phone ? normalizePhone(mapped.phone, studio.countryCode) : null;
      const email = mapped.email && EMAIL_PATTERN.test(mapped.email) ? mapped.email.slice(0, 120) : null;
      if (!phone && !email) return await this.settle(event.id, event.attempts, now, { transient: false, message: 'The lead has no usable phone number or e-mail address' });

      const attributes: Record<string, string> = { ...mapped.attributes };
      if (mapped.company) attributes.company = mapped.company;
      if (mapped.phone && !phone) attributes.phone_raw = mapped.phone.slice(0, 60);
      if (mapped.email && !email) attributes.email_raw = mapped.email.slice(0, 120);

      const occurredAt = event.createdTime ?? (fetched.lead.created_time ? new Date(fetched.lead.created_time) : now);
      const adIds = {
        campaignId: fetched.lead.campaign_id ?? null,
        adsetId: fetched.lead.adset_id ?? null,
        adId: fetched.lead.ad_id ?? (event.adIds as { adId?: string } | null)?.adId ?? null,
      };
      const contactId = await this.createContactAndAttribution(event, mapped, { phone, email, attributes, adIds, occurredAt, now });

      await this.prisma.$transaction([
        this.prisma.leadAdEvent.update({
          where: { id: event.id },
          data: {
            status: 'PROCESSED',
            processedAt: now,
            contactId,
            attributes: attributes as Prisma.InputJsonValue,
            adIds: adIds as Prisma.InputJsonValue,
            nextAttemptAt: null,
            lastError: null,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            studioId: event.studioId,
            userId: null,
            action: 'lead_ads.lead_received',
            entityType: 'LeadAdEvent',
            entityId: event.id,
            metadata: { leadgenId: event.leadgenId, formId: event.formId, contactId, consent: mapped.consentGiven === null ? 'no_question' : mapped.consentGiven ? 'given' : 'not_given' },
          },
        }),
      ]);
      return 'PROCESSED';
    } catch (err) {
      // A database or unexpected fault is transient: the same event can be tried again safely (every step is idempotent).
      return this.settle(event.id, event.attempts, now, { transient: true, message: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) });
    }
  }

  /** Contact, touchpoint, lead conversion, consent and activity; each step is idempotent so a retry after a partial failure is safe. */
  private async createContactAndAttribution(
    event: { id: string; studioId: string; leadgenId: string; formId: string; pageId: string; contactId: string | null },
    mapped: MappedLead,
    ctx: {
      phone: string | null;
      email: string | null;
      attributes: Record<string, string>;
      adIds: { campaignId: string | null; adsetId: string | null; adId: string | null };
      occurredAt: Date;
      now: Date;
    },
  ): Promise<string> {
    const studioId = event.studioId;
    const name = resolveLeadName({ ...mapped, email: ctx.email, phone: ctx.phone });
    const countryCode = mapped.countryCode ?? countryOfPhone(ctx.phone);

    const { contact, created } = await this.contacts.resolveOrCreate(studioId, {
      firstName: name.firstName,
      lastName: name.lastName,
      phone: ctx.phone,
      email: ctx.email,
      countryCode,
      lifecycleStage: 'LEAD',
      pipelineStageKey: 'NEW',
      sourceChannel: LEAD_AD_SOURCE_CHANNEL,
      sourceDetail: event.formId,
      utm: { source: LEAD_AD_UTM_SOURCE, medium: LEAD_AD_UTM_MEDIUM, campaign: ctx.adIds.campaignId },
    });
    if (!created) {
      // A known person filling another lead form: back into the pipeline when they had left it.
      const current = await this.prisma.contact.findFirst({ where: { id: contact.id, studioId }, include: { pipelineStage: true } });
      if (current && (!current.pipelineStage || current.pipelineStage.kind === 'LOST')) await this.contacts.moveToStage(current, 'NEW');
    }
    if (event.contactId !== contact.id) await this.prisma.leadAdEvent.update({ where: { id: event.id }, data: { contactId: contact.id } });

    await this.recordTouchpoint(studioId, contact.id, event, ctx);
    await this.conversions.recordSafely({
      studioId,
      type: 'lead',
      contactId: contact.id,
      occurredAt: ctx.occurredAt,
      source: { kind: LEAD_AD_CONVERSION_SOURCE_KIND, id: event.leadgenId },
    });
    await this.recordConsent(studioId, contact.id, event.formId, mapped, { phone: ctx.phone, email: ctx.email, countryCode: contact.countryCode ?? countryCode, locale: contact.locale });
    await this.recordActivity(studioId, contact.id, event, mapped, ctx);
    if (created) {
      await this.webhooks.emit(studioId, 'lead.created', {
        contactId: contact.id,
        fullName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        phone: contact.phone,
        email: contact.email,
        source: LEAD_AD_SOURCE_CHANNEL,
      });
    }
    return contact.id;
  }

  /** A synthetic visitor and session per lead (ids derived from the leadgen id), so the touch joins the normal attribution model. */
  private async recordTouchpoint(
    studioId: string,
    contactId: string,
    event: { leadgenId: string; formId: string },
    ctx: { adIds: { campaignId: string | null; adsetId: string | null; adId: string | null }; occurredAt: Date },
  ): Promise<void> {
    const visitorId = deterministicUuid(`lead-ad-visitor:${event.leadgenId}`);
    const sessionId = deterministicUuid(`lead-ad-session:${event.leadgenId}`);
    await this.prisma.visitor.upsert({
      where: { studioId_id: { studioId, id: visitorId } },
      create: { studioId, id: visitorId, firstSeenAt: ctx.occurredAt, lastSeenAt: ctx.occurredAt, contactId },
      update: { contactId },
    });
    const existing = await this.prisma.touchpoint.findFirst({ where: { studioId, visitorId, sessionId }, select: { id: true } });
    if (!existing) {
      await this.prisma.touchpoint.create({
        data: {
          studioId,
          visitorId,
          sessionId,
          occurredAt: ctx.occurredAt,
          landingPath: `/lead-ads/${event.formId}`,
          utmSource: LEAD_AD_UTM_SOURCE,
          utmMedium: LEAD_AD_UTM_MEDIUM,
          utmCampaign: ctx.adIds.campaignId,
          adPlatform: 'META',
          pwCid: ctx.adIds.campaignId,
          pwAsid: ctx.adIds.adsetId,
          pwAdid: ctx.adIds.adId,
          contactId,
        },
      });
    }
    await this.attribution.refreshContactTouches(studioId, contactId, ctx.occurredAt);
  }

  /**
   * M3e rules: a ticked consent question is marketing consent on the
   * channels the lead gave an address for, with the form id as the form
   * version; in a double opt-in region it waits for the confirmation link.
   * A form without a consent question, or an unticked box, records nothing:
   * the lead may only be sent transactional messages.
   */
  private async recordConsent(
    studioId: string,
    contactId: string,
    formId: string,
    mapped: MappedLead,
    person: { phone: string | null; email: string | null; countryCode: string | null; locale: string | null },
  ): Promise<void> {
    if (mapped.consentGiven !== true || !this.consentConfirmations) return;
    const channels: ContactConsentChannel[] = [...(person.email ? (['EMAIL'] as const) : []), ...(person.phone ? (['SMS'] as const) : [])];
    if (channels.length === 0) return;
    await this.consentConfirmations.afterFormConsent(studioId, contactId, { channels, formVersion: formId, countryCode: person.countryCode, locale: person.locale });
  }

  private async recordActivity(
    studioId: string,
    contactId: string,
    event: { leadgenId: string; formId: string; pageId: string },
    mapped: MappedLead,
    ctx: { attributes: Record<string, string>; adIds: { campaignId: string | null; adsetId: string | null; adId: string | null } },
  ): Promise<void> {
    const exists = await this.prisma.contactActivity.findFirst({
      where: { studioId, contactId, type: 'FORM', metadata: { path: ['leadgenId'], equals: event.leadgenId } },
      select: { id: true },
    });
    if (exists) return;
    await this.prisma.contactActivity.create({
      data: {
        studioId,
        contactId,
        type: 'FORM',
        body: `Meta Lead Ads: ${event.formId}`,
        metadata: {
          leadgenId: event.leadgenId,
          formId: event.formId,
          pageId: event.pageId,
          ...ctx.adIds,
          consent: mapped.consentGiven === null ? 'no_question' : mapped.consentGiven ? 'given' : 'not_given',
          attributes: ctx.attributes,
        } as Prisma.InputJsonValue,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Failure bookkeeping: a permanent failure or used-up attempts is FAILED, otherwise the event is scheduled for a retry. */
  private async settle(eventId: string, attempts: number, now: Date, failure: { transient: boolean; message: string }): Promise<ProcessOutcome> {
    const retryAt = failure.transient ? nextLeadAdAttemptAt(attempts, now) : null;
    const status: LeadAdEventStatus = retryAt ? 'RETRY' : 'FAILED';
    await this.prisma.leadAdEvent.update({
      where: { id: eventId },
      data: { status, nextAttemptAt: retryAt, lastError: failure.message.slice(0, 1000) },
    });
    if (status === 'FAILED') this.logger.warn(`Lead ad event ${eventId} failed for good: ${failure.message}`);
    return status;
  }

  private credentialsOf(encrypted: string): MetaCredentials | null {
    try {
      return JSON.parse(this.cipher.decrypt(encrypted)) as MetaCredentials;
    } catch {
      return null;
    }
  }

  private appSecretOf(encrypted: string): string | null {
    return this.credentialsOf(encrypted)?.appSecret ?? null;
  }
}
