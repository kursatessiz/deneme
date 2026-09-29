import { Injectable } from '@nestjs/common';
import type { Campaign, NotificationChannel } from '@platform/database';
import {
  APPROVAL_CHANNELS,
  GRANTED_APPROVAL_STATUSES,
  UNKNOWN_COUNTRY,
  complianceRegionOf,
  countryOfPhone,
  decideSelfApproval,
  effectiveChannelOrder,
  frequencyCapReached,
  parseMessagingSettings,
  parseNotificationSettings,
} from '@platform/shared';
import type {
  ApprovalChannel,
  ApprovalSummary,
  ComplianceRegion,
  ConsentIneligibilityReason,
  ConsentLegalBasis,
  ContactConsentChannel,
  MarketingSettingsDTO,
  PrecheckFinding,
  PrecheckFindingCode,
  TemplateChannel,
} from '@platform/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ComplianceService } from '../../../compliance/compliance.service';
import { ContactConsentService, ELIGIBILITY_CONTACT_SELECT } from '../../../notifications/consent/contact-consent.service';
import { normalizeAddress } from '../../../messaging/engine/opt-out.service';
import { localeChain, pickTemplate } from '../../../messaging/engine/template-resolver.service';
import { SegmentsService } from '../../segments/segments.service';
import { campaignContentHash, type CampaignVariantFingerprint, type TemplateFingerprintRow } from './content-hash';
import { parseAbSetup, parseOverrides } from '../campaign-ab.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 500;
/** Channels whose consent, opt-out and address the precheck evaluates per recipient. */
const ADDRESSED: readonly ApprovalChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];

/** Why a recipient cannot be reached on a channel; the M3e legal-basis reasons are counted separately. */
type BlockReason = 'CONSENT_MISSING' | 'OPTED_OUT' | 'NO_ADDRESS' | ConsentIneligibilityReason;
const BLOCK_REASONS: readonly BlockReason[] = ['CONSENT_MISSING', 'OPTED_OUT', 'NO_ADDRESS', 'DOUBLE_OPT_IN_PENDING', 'NO_LEGAL_BASIS', 'TR_EXEMPTION_DISABLED'];

export interface CampaignFingerprint {
  contentHash: string;
  channels: ApprovalChannel[];
  audienceCount: number;
  /** Audience contact ids (segment members now, or the snapshot of a campaign that already started). */
  contactIds: string[];
}

export interface CampaignPrecheck extends CampaignFingerprint {
  summary: ApprovalSummary;
}

type CampaignLike = Pick<Campaign, 'id' | 'studioId' | 'name' | 'segmentId' | 'channel' | 'templateKey' | 'startedAt' | 'audienceCount'> &
  Partial<Pick<Campaign, 'abTest' | 'sendTimeMode' | 'sendTimeLocal'>>;

/**
 * Dry run of a campaign send (docs/PAZARLAMA_MODULU.md 4.4 "Uyum ön
 * kontrolü", 6.1): the audience is evaluated with the same rules the
 * messaging engine applies per recipient (address, recorded consent,
 * suppression list, quiet hours at the planned time, frequency cap), without
 * sending anything and without touching the real send path. Produces the
 * approval summary (audience, countries and regions, cost estimate,
 * findings, reasons) and the content hash the approval is bound to.
 */
@Injectable()
export class CampaignPrecheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
    private readonly compliance: ComplianceService,
    private readonly consents: ContactConsentService,
  ) {}

  /** The hash only (templates, audience count, schedule, channel): used on the send path and after edits. */
  async fingerprint(campaign: CampaignLike, schedule: string | null, now: Date): Promise<CampaignFingerprint> {
    const studio = await this.prisma.studio.findUniqueOrThrow({ where: { id: campaign.studioId }, select: { notificationSettings: true } });
    const channels = this.channelsOf(campaign, studio.notificationSettings);
    const contactIds = await this.audience(campaign, now);
    const templates = await this.templateRows(campaign.studioId, campaign.templateKey, channels);
    // M3c: an A/B test is part of what was approved (variants, their templates and text, the setup); so is a send time mode.
    const abSetup = parseAbSetup(campaign.abTest);
    const variantRows = abSetup ? await this.prisma.campaignVariant.findMany({ where: { campaignId: campaign.id, studioId: campaign.studioId }, orderBy: { key: 'asc' } }) : [];
    const variants: CampaignVariantFingerprint[] = [];
    for (const v of variantRows) {
      variants.push({
        key: v.key,
        templateKey: v.templateKey,
        overrides: parseOverrides(v.templateOverrides),
        templates: v.templateKey && v.templateKey !== campaign.templateKey ? await this.templateRows(campaign.studioId, v.templateKey, channels) : [],
      });
    }
    const contentHash = campaignContentHash({
      channel: campaign.channel,
      channels,
      templateKey: campaign.templateKey,
      templates,
      segmentId: campaign.segmentId,
      audienceCount: contactIds.length,
      schedule,
      abTest: abSetup,
      variants,
      sendTime: campaign.sendTimeMode ? { mode: campaign.sendTimeMode, local: campaign.sendTimeLocal ?? null } : null,
    });
    return { contentHash, channels, audienceCount: contactIds.length, contactIds };
  }

  async run(campaign: CampaignLike, schedule: string | null, settings: MarketingSettingsDTO, now: Date): Promise<CampaignPrecheck> {
    const studio = await this.prisma.studio.findUniqueOrThrow({
      where: { id: campaign.studioId },
      select: { timezone: true, countryCode: true, address: true, defaultLocale: true, notificationSettings: true, messagingSettings: true },
    });
    const print = await this.fingerprint(campaign, schedule, now);
    const { channels, contactIds } = print;
    const sendAt = schedule ? new Date(schedule) : now;
    const addressed = channels.filter((c) => ADDRESSED.includes(c));

    const countries: Record<string, number> = {};
    const regions: Partial<Record<ComplianceRegion, number>> = {};
    const messages: Partial<Record<ApprovalChannel, number>> = {};
    const reachable: Partial<Record<ApprovalChannel, number>> = {};
    const blocked = Object.fromEntries(BLOCK_REASONS.map((r) => [r, 0])) as Record<BlockReason, number>;
    const legalBases: Partial<Record<ConsentLegalBasis, number>> = {};
    const policy = await this.consents.policyFor(campaign.studioId);
    let quietHours = 0;
    let frequencyCapped = 0;
    let usSms = 0;
    const cap = parseMessagingSettings(studio.messagingSettings).frequencyCap;

    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const ids = contactIds.slice(i, i + CHUNK);
      const contacts = await this.prisma.contact.findMany({
        where: { id: { in: ids }, studioId: campaign.studioId },
        select: { ...ELIGIBILITY_CONTACT_SELECT, countryCode: true, timezone: true },
      });
      // Same facts and rules as the send path (ContactConsentService + ComplianceService, M3e).
      const [batch, frequency] = await Promise.all([this.consents.batch(campaign.studioId, contacts, policy), this.frequency(campaign.studioId, ids, now)]);
      const addressesByChannel = new Map<ApprovalChannel, string[]>();
      const addressOf = (c: (typeof contacts)[number], channel: ApprovalChannel): string | null => {
        const user = c.membership?.user ?? null;
        if (channel === 'EMAIL') return c.email ?? user?.email ?? null;
        return c.phone ?? user?.phone ?? null;
      };
      for (const channel of addressed) {
        addressesByChannel.set(
          channel,
          contacts.map((c) => addressOf(c, channel)).filter((a): a is string => Boolean(a)).map((a) => normalizeAddress(channel as NotificationChannel, a)),
        );
      }
      const suppressed = new Set<string>();
      for (const [channel, addresses] of addressesByChannel) {
        if (!addresses.length) continue;
        const rows = await this.prisma.messageSuppression.findMany({
          where: { studioId: campaign.studioId, channel: channel as NotificationChannel, address: { in: addresses } },
          select: { address: true },
        });
        for (const r of rows) suppressed.add(`${channel}:${r.address}`);
      }

      for (const c of contacts) {
        const phone = c.phone ?? c.membership?.user.phone ?? null;
        const country = (c.countryCode || countryOfPhone(phone) || studio.countryCode || '').toUpperCase() || null;
        const countryKey = country ?? UNKNOWN_COUNTRY;
        countries[countryKey] = (countries[countryKey] ?? 0) + 1;
        const region = complianceRegionOf(country);
        regions[region] = (regions[region] ?? 0) + 1;
        if (channels.includes('SMS') && country === 'US' && addressOf(c, 'SMS')) usSms += 1;

        // First channel in order that passes address, consent and opt-out (the engine's fallback).
        let chosen: ApprovalChannel | null = null;
        let chosenBasis: ConsentLegalBasis | null = null;
        let firstBlock: BlockReason | null = null;
        for (const channel of addressed) {
          const address = addressOf(c, channel);
          let reason: BlockReason | null = null;
          let basis: ConsentLegalBasis | null = null;
          if (!address) reason = 'NO_ADDRESS';
          else if (suppressed.has(`${channel}:${normalizeAddress(channel as NotificationChannel, address)}`)) reason = 'OPTED_OUT';
          else {
            const decision = this.compliance.canSend({
              recipient: {
                countryCode: country,
                timezone: c.timezone,
                consentGranted: false,
                optedOut: false,
                legalBasis: {
                  policy,
                  consent: batch.facts(c.id, c.membership?.user.id ?? null, channel as ContactConsentChannel),
                  isBusiness: batch.isBusiness(c.id),
                  isExistingCustomer: batch.isExistingCustomer(c.id),
                },
              },
              channel,
              purpose: 'COMMERCIAL',
              skipQuietHours: true,
            });
            if (!decision.allow) {
              const code = decision.reasonCode;
              reason = code === 'DOUBLE_OPT_IN_PENDING' || code === 'NO_LEGAL_BASIS' || code === 'TR_EXEMPTION_DISABLED' ? code : code === 'OPTED_OUT' ? 'OPTED_OUT' : 'CONSENT_MISSING';
            } else {
              basis = decision.legalBasis ?? 'CONSENT';
            }
          }
          if (reason) {
            firstBlock ??= reason;
            continue;
          }
          reachable[channel] = (reachable[channel] ?? 0) + 1;
          if (!chosen) {
            chosen = channel;
            chosenBasis = basis;
          }
        }
        if (!chosen) {
          if (firstBlock) blocked[firstBlock] += 1;
          continue;
        }
        messages[chosen] = (messages[chosen] ?? 0) + 1;
        if (chosenBasis) legalBases[chosenBasis] = (legalBases[chosenBasis] ?? 0) + 1;
        const window = this.compliance.canSend({
          recipient: { countryCode: country, timezone: c.timezone, consentGranted: true, optedOut: false },
          channel: chosen,
          purpose: 'COMMERCIAL',
          now: sendAt,
          studioTimezone: studio.timezone,
        });
        if (!window.allow && window.reasonCode === 'QUIET_HOURS') quietHours += 1;
        if (frequencyCapReached(frequency.get(c.id) ?? { lastDay: 0, lastWeek: 0 }, cap)) frequencyCapped += 1;
      }
    }

    const findings: PrecheckFinding[] = [];
    const add = (code: PrecheckFindingCode, severity: 'warning' | 'info', channel: ApprovalChannel | null, count: number | null) =>
      findings.push({ code, severity, channel, count });

    const sendable = Object.values(messages).reduce((a, b) => a + (b ?? 0), 0);
    if (contactIds.length === 0) add('AUDIENCE_EMPTY', 'warning', null, 0);
    else if (sendable === 0 && addressed.length > 0) add('NO_SENDABLE_RECIPIENTS', 'warning', null, contactIds.length);

    // Templates for the studio's default language (recipients in other languages fall back the same way).
    const locales = localeChain(null, studio.defaultLocale);
    const templateRows = await this.prisma.messageTemplate.findMany({
      where: { key: campaign.templateKey, isActive: true, channel: { in: channels as TemplateChannel[] }, OR: [{ studioId: campaign.studioId }, { studioId: null }] },
    });
    let resolved = 0;
    for (const channel of channels) {
      const variant = pickTemplate(
        templateRows.filter((r) => r.channel === channel),
        campaign.studioId,
        campaign.templateKey,
        channel as TemplateChannel,
        locales,
      );
      if (!variant) {
        // A missing template on one channel of the tenant order only makes the engine fall through.
        add('TEMPLATE_MISSING', campaign.channel ? 'warning' : 'info', channel, null);
        continue;
      }
      resolved += 1;
      if (channel === 'WHATSAPP' && (!variant.whatsappTemplateName || variant.whatsappStatus !== 'APPROVED')) {
        add('WHATSAPP_TEMPLATE_NOT_APPROVED', campaign.channel ? 'warning' : 'info', channel, null);
      }
    }
    if (!campaign.channel && channels.length > 0 && resolved === 0) add('TEMPLATE_MISSING', 'warning', null, null);

    let emailDomainVerified = false;
    if (channels.includes('EMAIL')) {
      if (!studio.address?.trim()) add('PHYSICAL_ADDRESS_MISSING', 'warning', 'EMAIL', null);
      emailDomainVerified =
        (await this.prisma.emailSenderDomain.count({
          where: { studioId: campaign.studioId, purpose: 'MARKETING', spfStatus: 'VALID', dkimStatus: 'VALID', dmarcStatus: 'VALID' },
        })) > 0;
      if (!emailDomainVerified) add('EMAIL_DOMAIN_NOT_VERIFIED', 'warning', 'EMAIL', null);
    }
    const smsCredits = messages.SMS ?? 0;
    if (channels.includes('SMS') && smsCredits > 0) {
      const wallet = await this.prisma.smsWallet.findUnique({ where: { studioId: campaign.studioId }, select: { balance: true } });
      if ((wallet?.balance ?? 0) < smsCredits) add('SMS_CREDITS_INSUFFICIENT', 'warning', 'SMS', smsCredits);
    }
    if (usSms > 0) add('US_SMS_RECIPIENTS', 'warning', 'SMS', usSms);
    if (blocked.CONSENT_MISSING) add('CONSENT_MISSING', 'info', null, blocked.CONSENT_MISSING);
    if (blocked.OPTED_OUT) add('OPTED_OUT', 'info', null, blocked.OPTED_OUT);
    if (blocked.NO_ADDRESS) add('NO_ADDRESS', 'info', null, blocked.NO_ADDRESS);
    if (blocked.DOUBLE_OPT_IN_PENDING) add('DOUBLE_OPT_IN_PENDING', 'info', null, blocked.DOUBLE_OPT_IN_PENDING);
    if (blocked.NO_LEGAL_BASIS) add('NO_LEGAL_BASIS', 'info', null, blocked.NO_LEGAL_BASIS);
    if (blocked.TR_EXEMPTION_DISABLED) add('TR_EXEMPTION_DISABLED', 'info', null, blocked.TR_EXEMPTION_DISABLED);
    if (quietHours) add('QUIET_HOURS', 'info', null, quietHours);
    if (frequencyCapped) add('FREQUENCY_CAP', 'info', null, frequencyCapped);

    const history = await this.history(campaign);
    const newCountries = Object.keys(countries)
      .filter((c) => c !== UNKNOWN_COUNTRY && !history.countries.has(c))
      .sort();
    const thresholds = {
      selfApproveEmailMax: settings.selfApproveEmailMax,
      selfApproveSmsMax: settings.selfApproveSmsMax,
      selfApproveSmsCredits: settings.selfApproveSmsCredits,
    };
    const decision = decideSelfApproval({
      channels,
      audienceTotal: contactIds.length,
      smsCredits,
      usSmsRecipients: usSms > 0,
      segmentApprovedBefore: history.segmentApprovedBefore,
      newCountries,
      findings,
      emailDomainVerified,
      thresholds,
    });
    const segment = await this.prisma.segment.findFirst({ where: { id: campaign.segmentId, studioId: campaign.studioId }, select: { name: true } });

    const summary: ApprovalSummary = {
      version: 1,
      target: {
        name: campaign.name,
        channel: campaign.channel,
        templateKey: campaign.templateKey,
        segmentId: campaign.segmentId,
        segmentName: segment?.name ?? null,
      },
      requestedSchedule: schedule,
      channels,
      audience: { total: contactIds.length, reachable },
      countries,
      regions,
      newCountries,
      // No channel carries a price with a currency today (SMS is sold in credits), so byCurrency stays empty.
      cost: { smsCredits, messages, byCurrency: {} },
      findings,
      reasons: decision.reasons,
      selfApprovable: decision.selfApprovable,
      segmentApprovedBefore: history.segmentApprovedBefore,
      emailDomainVerified,
      thresholds,
      evaluatedAt: now.toISOString(),
      legalBases,
    };
    return { ...print, summary };
  }

  // ---------------------------------------------------------------------------

  channelsOf(campaign: Pick<Campaign, 'channel'>, notificationSettings: unknown): ApprovalChannel[] {
    if (campaign.channel) return [campaign.channel as ApprovalChannel];
    const order: readonly ApprovalChannel[] = effectiveChannelOrder(parseNotificationSettings(notificationSettings));
    return order.filter((c) => (APPROVAL_CHANNELS as readonly string[]).includes(c));
  }

  private async audience(campaign: CampaignLike, now: Date): Promise<string[]> {
    if (campaign.startedAt) {
      const rows = await this.prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id, studioId: campaign.studioId }, select: { contactId: true } });
      return rows.map((r) => r.contactId);
    }
    return this.segments.memberIds(campaign.studioId, campaign.segmentId, now);
  }

  private async templateRows(studioId: string, key: string, channels: readonly ApprovalChannel[]): Promise<TemplateFingerprintRow[]> {
    const rows = await this.prisma.messageTemplate.findMany({
      where: { key, isActive: true, channel: { in: channels as TemplateChannel[] }, OR: [{ studioId }, { studioId: null }] },
      select: {
        studioId: true,
        channel: true,
        locale: true,
        body: true,
        subject: true,
        blocks: true,
        whatsappTemplateName: true,
        whatsappStatus: true,
        isTransactional: true,
      },
    });
    return rows.map((r) => ({
      channel: r.channel,
      locale: r.locale,
      source: r.studioId ? 'TENANT' : 'GLOBAL',
      body: r.body,
      subject: r.subject,
      blocks: r.blocks,
      whatsappTemplateName: r.whatsappTemplateName,
      whatsappStatus: r.whatsappStatus,
      isTransactional: r.isTransactional,
    }));
  }

  /** Commercial messages per contact in the last day and week (frequency cap), in two grouped queries. */
  private async frequency(studioId: string, contactIds: string[], now: Date): Promise<Map<string, { lastDay: number; lastWeek: number }>> {
    const out = new Map<string, { lastDay: number; lastWeek: number }>();
    if (!contactIds.length) return out;
    const base = { studioId, purpose: 'COMMERCIAL' as const, status: { in: ['PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'] as ('PENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED')[] }, contactId: { in: contactIds } };
    const [week, day] = await Promise.all([
      this.prisma.notificationLog.groupBy({ by: ['contactId'], where: { ...base, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }, _count: { _all: true } }),
      this.prisma.notificationLog.groupBy({ by: ['contactId'], where: { ...base, createdAt: { gte: new Date(now.getTime() - DAY_MS) } }, _count: { _all: true } }),
    ]);
    for (const w of week) if (w.contactId) out.set(w.contactId, { lastDay: 0, lastWeek: w._count._all });
    for (const d of day) if (d.contactId) out.set(d.contactId, { lastDay: d._count._all, lastWeek: out.get(d.contactId)?.lastWeek ?? d._count._all });
    return out;
  }

  /** Earlier granted campaign requests of the tenant: was this segment approved before, which countries were reached. */
  private async history(campaign: CampaignLike): Promise<{ segmentApprovedBefore: boolean; countries: Set<string> }> {
    const granted = await this.prisma.approvalRequest.findMany({
      where: { studioId: campaign.studioId, targetType: 'CAMPAIGN', status: { in: [...GRANTED_APPROVAL_STATUSES] } },
      select: { summary: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const countries = new Set<string>();
    let segmentApprovedBefore = false;
    for (const row of granted) {
      const summary = row.summary as Partial<ApprovalSummary> | null;
      if (!summary || typeof summary !== 'object') continue;
      for (const c of Object.keys(summary.countries ?? {})) countries.add(c);
      if (summary.target?.segmentId === campaign.segmentId) segmentApprovedBefore = true;
    }
    return { segmentApprovedBefore, countries };
  }
}
