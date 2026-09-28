import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@platform/database';
import type { NotificationChannel, NotificationLog, NotificationStatus } from '@platform/database';
import {
  BASE_MESSAGES,
  BUNDLED_MESSAGES,
  MessageRenderError,
  countryOfPhone,
  createTranslator,
  effectiveChannelOrder,
  emailBrandOf,
  emailLinkTargets,
  frequencyCapReached,
  interpolateEmailBlocks,
  messagePlaceholders,
  parseMessagingSettings,
  parseNotificationSettings,
  renderEmail,
  renderMessageText,
} from '@platform/shared';
import type {
  ConsentChannelName,
  EmailBlock,
  EngineChannel,
  FrequencyCounts,
  MessagePurpose,
  MessageSendReasonCode,
  ResolvedMessagingSettings,
} from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ComplianceService } from '../../compliance/compliance.service';
import { ConsentService } from '../../notifications/consent/consent.service';
import { NotificationPreferencesService } from '../../notifications/notification-preferences.service';
import { PushService } from '../../notifications/push.service';
import { MessagingChannelRegistry } from '../channels/channel-registry.service';
import type { ChannelSendResult } from '../channels/message-channel.interface';
import { MessagingUrls } from '../tracking/messaging-urls.service';
import { TemplateResolver, localeChain } from './template-resolver.service';
import type { ResolvedTemplateVariant } from './template-resolver.service';
import { OptOutService } from './opt-out.service';
import type { ResolvedRecipient, SendMessageInput, SendMessageResult } from './messaging.types';

export const REDACTED = '[gizli icerik]';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Statuses that mean "this attempt went (or is going) out". */
const SENT_LIKE: NotificationStatus[] = ['PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED'];

const STUDIO_SELECT = {
  id: true,
  name: true,
  email: true,
  address: true,
  timezone: true,
  countryCode: true,
  defaultLocale: true,
  logoUrl: true,
  themeFamily: true,
  themePrimary: true,
  gradientPresetKey: true,
  notificationSettings: true,
  messagingSettings: true,
} satisfies Prisma.StudioSelect;
type StudioInfo = Prisma.StudioGetPayload<{ select: typeof STUDIO_SELECT }>;

interface AttemptContext {
  input: SendMessageInput;
  studio: StudioInfo | null;
  settings: ReturnType<typeof parseNotificationSettings>;
  messaging: ResolvedMessagingSettings;
  recipient: ResolvedRecipient;
  locales: string[];
  regionCountry: string | null;
  prefs: { push: boolean; sms: boolean } | null;
  now: Date;
  /** Set once the idempotency key has been claimed by a log row of this send. */
  keyClaimed: boolean;
  frequency: FrequencyCounts | null;
  fallbackOfId: string | undefined;
}

type AttemptOutcome =
  | { kind: 'sent'; result: SendMessageResult }
  | { kind: 'duplicate'; result: SendMessageResult }
  | { kind: 'skipped'; reason: string; code: MessageSendReasonCode; logId?: string };

/**
 * The single entry point for every outgoing message (docs/MESAJLASMA.md).
 * Per channel attempt, in order:
 *   1. the member's category toggles (legacy notification categories);
 *   2. template resolution for the channel and locale (tenant -> global ->
 *      built-in, per locale: recipient, studio default, tr) -- needed first
 *      only to learn whether the message is commercial;
 *   3. compliance.canSend: consent, opt-out/suppression and, for COMMERCIAL
 *      only, quiet hours in the recipient's time zone (transactional
 *      messages keep today's behaviour: never gated);
 *   4. the per-contact frequency cap (COMMERCIAL only; tenant setting,
 *      default 3 a day / 10 a week, all channels together);
 *   5. idempotency: the first delivery record claims the key;
 *   6. variable interpolation (strict; a missing variable skips the channel);
 *   7. delivery through the provider registry, recorded on NotificationLog.
 * A failed or skipped channel falls through to the next one in the order.
 * SMS credits are reserved before an SMS attempt and kept only when the
 * provider accepted it (rule 8).
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly compliance: ComplianceService,
    private readonly consents: ConsentService,
    private readonly preferences: NotificationPreferencesService,
    private readonly push: PushService,
    private readonly registry: MessagingChannelRegistry,
    private readonly templates: TemplateResolver,
    private readonly optOut: OptOutService,
    private readonly urls: MessagingUrls,
  ) {}

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    if (!input.templateKey && !input.templateId && !input.content) {
      throw new Error('MessagingService.send needs templateKey, templateId or content');
    }
    const studio = input.studioId ? await this.prisma.studio.findUnique({ where: { id: input.studioId }, select: STUDIO_SELECT }) : null;
    if (input.studioId && !studio) return { success: false, reason: 'İşletme bulunamadı', reasonCode: 'RECIPIENT_NOT_FOUND' };

    if (input.idempotencyKey && input.studioId) {
      const prior = await this.priorResult(input.studioId, input.idempotencyKey);
      if (prior) return prior;
    }

    const recipient = await this.resolveRecipient(input.studioId, input.recipient);
    if (!recipient) return { success: false, reason: 'Kullanıcı bulunamadı', reasonCode: 'RECIPIENT_NOT_FOUND' };

    const settings = parseNotificationSettings(studio?.notificationSettings);
    const ctx: AttemptContext = {
      input,
      studio,
      settings,
      messaging: parseMessagingSettings(studio?.messagingSettings),
      recipient,
      locales: localeChain(input.locale ?? recipient.locale, studio?.defaultLocale ?? null),
      regionCountry: recipient.countryCode ?? countryOfPhone(recipient.phone) ?? studio?.countryCode ?? null,
      prefs: input.category && recipient.userId ? await this.preferences.channelsFor(recipient.userId, input.category) : null,
      now: new Date(),
      keyClaimed: false,
      frequency: null,
      fallbackOfId: undefined,
    };

    const order: EngineChannel[] = input.channel
      ? [input.channel]
      : input.channels && input.channels.length > 0
        ? input.channels
        : effectiveChannelOrder(settings);

    let last: { reason: string; code: MessageSendReasonCode } = { reason: 'Yapılandırılmış kanal yok', code: 'NO_TEMPLATE' };
    for (const channel of order) {
      const outcome = await this.attempt(ctx, channel);
      if (outcome.kind !== 'skipped') return outcome.result;
      if (outcome.logId) ctx.fallbackOfId = outcome.logId;
      last = { reason: outcome.reason, code: outcome.code };
    }
    return { success: false, reason: last.reason, reasonCode: last.code, notificationLogId: ctx.fallbackOfId };
  }

  // ---------------------------------------------------------------------------
  // One channel attempt
  // ---------------------------------------------------------------------------

  private async attempt(ctx: AttemptContext, channel: EngineChannel): Promise<AttemptOutcome> {
    const { input, recipient, studio } = ctx;

    // 1. Member toggles for legacy categories (SMS/WhatsApp follow "sms", push/in-app follow "push").
    if (ctx.prefs) {
      const allowed = channel === 'PUSH' || channel === 'IN_APP' ? ctx.prefs.push : channel === 'EMAIL' ? true : ctx.prefs.sms;
      if (!allowed) return { kind: 'skipped', reason: 'Kullanıcı bu kategori için kapatmış', code: 'PREFERENCE_OFF' };
    }

    const address = this.addressFor(channel, recipient);
    if (!address) return { kind: 'skipped', reason: `Alıcının ${channel} adresi yok`, code: 'NO_ADDRESS' };
    if (channel === 'PUSH' && !(await this.push.hasDevices(address))) {
      return { kind: 'skipped', reason: 'Kayıtlı cihaz yok', code: 'NO_ADDRESS' };
    }

    // 2. Template (or free text).
    const variant = await this.variantFor(ctx, channel);
    if (!variant) {
      return { kind: 'skipped', reason: `"${input.templateKey ?? input.templateId ?? input.type}" için ${channel} şablonu yok`, code: 'NO_TEMPLATE' };
    }
    const freeFormWhatsApp = channel === 'WHATSAPP' && Boolean(input.whatsappFreeForm);
    if (channel === 'WHATSAPP' && !freeFormWhatsApp && (!variant.whatsappTemplateName || variant.whatsappStatus !== 'APPROVED')) {
      return { kind: 'skipped', reason: 'WhatsApp şablonu Meta tarafından onaylı değil', code: 'TEMPLATE_NOT_APPROVED' };
    }
    const purpose: MessagePurpose = input.purpose === 'COMMERCIAL' || !variant.isTransactional ? 'COMMERCIAL' : 'TRANSACTIONAL';

    // 3. Compliance: consent, opt-out and (commercial only) quiet hours.
    if (purpose === 'COMMERCIAL') {
      if (!input.studioId || !studio) return { kind: 'skipped', reason: 'Ticari mesaj bir işletme adına gönderilmelidir', code: 'CONSENT_REQUIRED' };
      const [consentGranted, suppressed] = await Promise.all([
        this.consentFor(input.studioId, recipient, channel),
        channel === 'PUSH' || channel === 'IN_APP' ? Promise.resolve(false) : this.optOut.isSuppressed(input.studioId, channel, address),
      ]);
      const decision = this.compliance.canSend({
        recipient: { countryCode: ctx.regionCountry, timezone: recipient.timezone, consentGranted, optedOut: suppressed },
        channel,
        purpose,
        now: ctx.now,
        studioTimezone: studio.timezone,
      });
      if (!decision.allow) {
        return { kind: 'skipped', reason: decision.reason ?? `${channel} için gönderim engellendi`, code: decision.reasonCode ?? 'CONSENT_REQUIRED' };
      }

      // 4. Frequency cap per contact, all channels together.
      ctx.frequency ??= await this.frequencyCounts(input.studioId, recipient, ctx.now);
      if (frequencyCapReached(ctx.frequency, ctx.messaging.frequencyCap)) {
        return { kind: 'skipped', reason: 'Sıklık sınırı aşıldı (kişi başına ticari mesaj)', code: 'FREQUENCY_CAP' };
      }
    }

    // 6. Render (before the claim, so a broken template never burns the idempotency key).
    const variables: Record<string, string | number> = {
      studioName: studio?.name ?? '',
      firstName: recipient.firstName ?? '',
      ...(input.variables ?? {}),
    };
    let text: string;
    let subject: string | null;
    let blocks: EmailBlock[] | null = null;
    try {
      if (input.content) {
        text = input.content.text;
        subject = input.content.subject ?? null;
      } else {
        text = renderMessageText(variant.body, variables, variant.locale);
        subject = variant.subject ? renderMessageText(variant.subject, variables, variant.locale) : null;
      }
      if (channel === 'EMAIL') {
        const source: EmailBlock[] = variant.blocks ?? [
          ...(subject ? [{ type: 'heading' as const, text: input.content ? subject : variant.subject ?? '' }] : []),
          { type: 'paragraph', text: input.content ? text : variant.body },
        ];
        blocks = input.content ? source : interpolateEmailBlocks(source, variables, variant.locale);
      }
    } catch (err) {
      if (err instanceof MessageRenderError) return { kind: 'skipped', reason: err.message, code: 'RENDER_ERROR' };
      throw err;
    }
    if (channel === 'EMAIL' && !subject) {
      return { kind: 'skipped', reason: 'E-posta konusu yok', code: 'NO_TEMPLATE' };
    }

    // 5. Idempotency claim: the first delivery record of this send carries the key.
    const claimKey = input.idempotencyKey && input.studioId && !ctx.keyClaimed ? input.idempotencyKey : null;
    let log: NotificationLog;
    try {
      log = await this.prisma.notificationLog.create({
        data: {
          studioId: input.studioId,
          recipientPhone: channel === 'SMS' || channel === 'WHATSAPP' ? address : recipient.phone,
          recipientEmail: channel === 'EMAIL' ? address : null,
          userId: recipient.userId,
          contactId: recipient.contactId,
          channel,
          purpose,
          type: (input.type ?? input.templateKey ?? 'MESSAGE').slice(0, 50),
          templateId: variant.id,
          locale: variant.locale,
          subject: subject ? subject.slice(0, 200) : null,
          content: input.sensitive ? REDACTED : text,
          status: 'PENDING',
          fallbackOfId: ctx.fallbackOfId,
          idempotencyKey: claimKey,
          campaignId: input.campaignId ?? null,
          journeyRunId: input.journeyRunId ?? null,
        },
      });
    } catch (err) {
      if (claimKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const prior = await this.priorResult(input.studioId!, claimKey);
        return { kind: 'duplicate', result: prior ?? { success: true, duplicate: true } };
      }
      throw err;
    }
    if (claimKey) ctx.keyClaimed = true;

    // 7. Delivery.
    const dispatched = await this.dispatch(ctx, channel, log, { address, text, subject, blocks, variant, purpose, freeFormWhatsApp, variables });
    if (dispatched.skippedReason) {
      await this.finish(log.id, 'FAILED', dispatched.provider, undefined, dispatched.skippedReason.reason);
      await this.appendToConversation(ctx, log, text, 'FAILED', dispatched.provider, undefined);
      return { kind: 'skipped', reason: dispatched.skippedReason.reason, code: dispatched.skippedReason.code, logId: log.id };
    }
    const result = dispatched.result!;
    await this.finish(log.id, result.success ? 'SENT' : 'FAILED', dispatched.provider, result.providerMessageId, result.errorMessage);
    await this.appendToConversation(ctx, log, text, result.success ? 'SENT' : 'FAILED', dispatched.provider, result.providerMessageId);

    if (result.success) {
      if (purpose === 'COMMERCIAL' && ctx.frequency) {
        ctx.frequency = { lastDay: ctx.frequency.lastDay + 1, lastWeek: ctx.frequency.lastWeek + 1 };
      }
      return {
        kind: 'sent',
        result: {
          success: true,
          channel,
          providerMessageId: result.providerMessageId,
          notificationLogId: log.id,
          ...(dispatched.pushedDevices !== undefined ? { pushedDevices: dispatched.pushedDevices } : {}),
        },
      };
    }
    return {
      kind: 'skipped',
      reason: result.errorMessage ?? `${channel} gönderimi başarısız`,
      code: result.notConfigured ? 'NOT_CONFIGURED' : 'PROVIDER_ERROR',
      logId: log.id,
    };
  }

  private async dispatch(
    ctx: AttemptContext,
    channel: EngineChannel,
    log: NotificationLog,
    msg: {
      address: string;
      text: string;
      subject: string | null;
      blocks: EmailBlock[] | null;
      variant: ResolvedTemplateVariant;
      purpose: MessagePurpose;
      freeFormWhatsApp: boolean;
      variables: Record<string, string | number>;
    },
  ): Promise<{
    provider: string;
    result?: ChannelSendResult;
    pushedDevices?: number;
    skippedReason?: { reason: string; code: MessageSendReasonCode };
  }> {
    const { input, studio } = ctx;
    switch (channel) {
      case 'SMS': {
        const adapter = this.registry.resolveSms(countryOfPhone(msg.address) ?? studio?.countryCode ?? null, ctx.messaging.smsProvider);
        const provider = adapter.isConfigured() ? adapter.key : 'MOCK';
        let reservation: { walletId: string; balanceAfter: number } | null = null;
        if (input.studioId && input.billing !== 'EXEMPT') {
          reservation = await this.reserveSmsCredit(input.studioId);
          if (!reservation) return { provider, skippedReason: { reason: 'Stüdyo SMS kredisi yetersiz', code: 'INSUFFICIENT_CREDIT' } };
        }
        if (!adapter.isConfigured() && input.sensitive && this.config.get<string>('NODE_ENV') === 'development') {
          // Local development only: show the real text so codes can be used.
          this.logger.warn(`[MOCK SMS] ${msg.address}: ${msg.text}`);
        }
        const result = await adapter.send({
          phone: msg.address,
          body: msg.text,
          params: stringParams(msg.variables),
          senderName: ctx.settings.smsSenderName,
        });
        if (reservation && input.studioId) {
          if (result.success) {
            await this.prisma.smsTransaction.create({
              data: {
                studioId: input.studioId,
                walletId: reservation.walletId,
                type: 'USAGE',
                amount: -1,
                balanceAfter: reservation.balanceAfter,
                notificationLogId: log.id,
              },
            });
          } else {
            // Nothing was delivered: give the reserved credit back, no ledger entry (rule 8).
            await this.prisma.smsWallet.updateMany({ where: { studioId: input.studioId }, data: { balance: { increment: 1 } } });
          }
        }
        return { provider, result };
      }
      case 'WHATSAPP': {
        const adapter = this.registry.whatsapp;
        const provider = adapter.isConfigured() ? adapter.key : 'MOCK';
        const used = new Set(messagePlaceholders(msg.variant.body));
        const params = Object.fromEntries(Object.entries(stringParams(msg.variables)).filter(([k]) => used.has(k)));
        const result = await adapter.send({
          phone: msg.address,
          body: msg.text,
          params,
          whatsappTemplateName: msg.freeFormWhatsApp ? undefined : (msg.variant.whatsappTemplateName ?? undefined),
          languageCode: msg.variant.locale,
          freeForm: msg.freeFormWhatsApp,
        });
        return { provider, result };
      }
      case 'EMAIL':
        return this.dispatchEmail(ctx, log, msg);
      case 'PUSH': {
        const userId = ctx.recipient.userId!;
        const devices = await this.push.sendToUser(userId, {
          title: msg.subject ?? studio?.name ?? '',
          body: msg.text,
          data: input.content?.data,
        });
        return {
          provider: 'EXPO',
          pushedDevices: devices,
          result: devices > 0 ? { success: true } : { success: false, errorMessage: 'Kayıtlı cihaz yok' },
        };
      }
      case 'IN_APP':
        // The delivery record itself is the stored message the app lists.
        return { provider: 'IN_APP', result: { success: true } };
    }
  }

  private async dispatchEmail(
    ctx: AttemptContext,
    log: NotificationLog,
    msg: { address: string; text: string; subject: string | null; blocks: EmailBlock[] | null; variant: ResolvedTemplateVariant; purpose: MessagePurpose },
  ): Promise<{ provider: string; result?: ChannelSendResult; skippedReason?: { reason: string; code: MessageSendReasonCode } }> {
    const { studio } = ctx;
    const adapter = this.registry.email;
    const provider = adapter.isConfigured() ? adapter.key : 'MOCK';
    const commercial = msg.purpose === 'COMMERCIAL';
    const locale = msg.variant.locale;
    const t = createTranslator({ locale, messages: BUNDLED_MESSAGES[locale] ?? BASE_MESSAGES, fallback: BASE_MESSAGES });
    const studioName = studio?.name ?? this.config.get<string>('SES_FROM_NAME') ?? '';

    let unsubscribeToken: string | null = null;
    if (commercial) {
      unsubscribeToken = this.urls.sign('u', log.id);
      if (!unsubscribeToken) {
        return { provider, skippedReason: { reason: 'Takip anahtarı (MESSAGING_TRACKING_SECRET) yapılandırılmamış', code: 'NOT_CONFIGURED' } };
      }
      if (!studio?.address?.trim()) {
        return { provider, skippedReason: { reason: 'İşletme adresi tanımlı değil (ticari e-posta için zorunlu)', code: 'NOT_CONFIGURED' } };
      }
    }

    // Click tracking: every http(s) link is replaced by a signed reference to a stored target.
    const blocks = msg.blocks ?? [];
    const linkMap = new Map<string, string>();
    if (studio && this.urls.secret()) {
      for (const url of emailLinkTargets(blocks)) {
        const link = await this.prisma.messageLink.create({ data: { studioId: studio.id, notificationLogId: log.id, url } });
        const token = this.urls.sign('c', link.id);
        if (token) linkMap.set(url, this.urls.clickUrl(token));
      }
    }
    const openToken = commercial ? this.urls.sign('o', log.id) : null;

    const rendered = renderEmail({
      lang: locale,
      subject: msg.subject ?? '',
      blocks,
      brand: emailBrandOf(studio ?? { name: studioName }),
      footer: {
        physicalAddress: studio?.address?.trim() || null,
        reasonText: t(commercial ? 'msgTpl.email.reasonCommercial' : 'msgTpl.email.reasonTransactional', { studioName }),
        unsubscribe: unsubscribeToken ? { url: this.urls.unsubscribePageUrl(unsubscribeToken), label: t('msgTpl.email.unsubscribe') } : null,
      },
      openPixelUrl: openToken ? this.urls.openPixelUrl(openToken) : null,
      rewriteLink: (url) => linkMap.get(url) ?? url,
    });

    const headers: Record<string, string> = {};
    if (unsubscribeToken) {
      headers['List-Unsubscribe'] = `<${this.urls.unsubscribeOneClickUrl(unsubscribeToken)}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    if (!ctx.input.sensitive) {
      await this.prisma.notificationLog.update({ where: { id: log.id }, data: { content: rendered.text } });
    }
    const result = await adapter.send({
      to: msg.address,
      fromName: ctx.messaging.emailFromName ?? studioName,
      replyTo: ctx.messaging.emailReplyTo ?? studio?.email ?? null,
      subject: msg.subject ?? '',
      html: rendered.html,
      text: rendered.text,
      headers,
    });
    return { provider, result };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private addressFor(channel: EngineChannel, recipient: ResolvedRecipient): string | null {
    switch (channel) {
      case 'SMS':
      case 'WHATSAPP':
        return recipient.phone;
      case 'EMAIL':
        return recipient.email;
      case 'PUSH':
      case 'IN_APP':
        return recipient.userId;
    }
  }

  private async variantFor(ctx: AttemptContext, channel: EngineChannel): Promise<ResolvedTemplateVariant | null> {
    const { input } = ctx;
    if (input.content) {
      return {
        id: null,
        key: input.type ?? 'MESSAGE',
        source: 'BUILTIN',
        locale: ctx.locales[0],
        body: input.content.text,
        subject: input.content.subject ?? null,
        blocks: null,
        whatsappTemplateName: null,
        whatsappStatus: null,
        isTransactional: true,
      };
    }
    if (input.templateId) return this.templates.resolveById(input.studioId, input.templateId, channel);
    return this.templates.resolve(input.studioId, input.templateKey!, channel, ctx.locales);
  }

  /** Recorded opt-in for a commercial message on this channel. */
  private async consentFor(studioId: string, recipient: ResolvedRecipient, channel: EngineChannel): Promise<boolean> {
    if (channel === 'IN_APP') return true;
    if (!recipient.userId) return false;
    if (channel === 'PUSH') return (await this.preferences.channelsFor(recipient.userId, 'MARKETING')).push;
    return this.consents.isGranted(studioId, recipient.userId, channel as ConsentChannelName);
  }

  private async frequencyCounts(studioId: string, recipient: ResolvedRecipient, now: Date): Promise<FrequencyCounts> {
    const who: Prisma.NotificationLogWhereInput = recipient.contactId
      ? { contactId: recipient.contactId }
      : recipient.userId
        ? { userId: recipient.userId }
        : recipient.phone
          ? { recipientPhone: recipient.phone }
          : { recipientEmail: recipient.email };
    const base: Prisma.NotificationLogWhereInput = { studioId, purpose: 'COMMERCIAL', status: { in: SENT_LIKE }, ...who };
    const [lastDay, lastWeek] = await Promise.all([
      this.prisma.notificationLog.count({ where: { ...base, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
      this.prisma.notificationLog.count({ where: { ...base, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    ]);
    return { lastDay, lastWeek };
  }

  /**
   * The result of an earlier send with this key, or null when the key is
   * free (never used, or every attempt of that send failed -- then the key
   * is released so the caller's retry can go out).
   */
  private async priorResult(studioId: string, key: string): Promise<SendMessageResult | null> {
    const first = await this.prisma.notificationLog.findFirst({ where: { studioId, idempotencyKey: key } });
    if (!first) return null;
    let chain: NotificationLog[] = [first];
    let frontier = [first.id];
    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      const next = await this.prisma.notificationLog.findMany({ where: { studioId, fallbackOfId: { in: frontier } } });
      chain = chain.concat(next);
      frontier = next.map((n) => n.id);
    }
    const delivered = chain.find((l) => SENT_LIKE.includes(l.status));
    if (delivered) {
      return {
        success: true,
        duplicate: true,
        channel: delivered.channel as EngineChannel,
        notificationLogId: delivered.id,
        providerMessageId: delivered.providerMessageId ?? undefined,
        reasonCode: 'DUPLICATE',
      };
    }
    await this.prisma.notificationLog.updateMany({ where: { id: first.id, idempotencyKey: key }, data: { idempotencyKey: null } });
    return null;
  }

  private async resolveRecipient(studioId: string | null, ref: SendMessageInput['recipient']): Promise<ResolvedRecipient | null> {
    const empty: ResolvedRecipient = {
      contactId: null,
      userId: null,
      membershipId: null,
      firstName: null,
      phone: null,
      email: null,
      locale: null,
      countryCode: null,
      timezone: null,
    };
    if ('phone' in ref) return { ...empty, phone: ref.phone };
    if ('email' in ref) return { ...empty, email: ref.email.trim().toLowerCase() };
    if (!studioId && !('userId' in ref)) return null;

    if ('contactId' in ref) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: ref.contactId, studioId: studioId!, mergedIntoId: null },
        include: { membership: { include: { user: true } } },
      });
      if (!contact) return null;
      const user = contact.membership?.user ?? null;
      return {
        contactId: contact.id,
        userId: user?.id ?? null,
        membershipId: contact.membershipId,
        firstName: contact.firstName,
        phone: contact.phone ?? user?.phone ?? null,
        email: contact.email ?? user?.email ?? null,
        locale: contact.locale ?? user?.locale ?? null,
        countryCode: contact.countryCode,
        timezone: contact.timezone,
      };
    }

    const membership =
      'membershipId' in ref
        ? await this.prisma.membership.findFirst({ where: { id: ref.membershipId, studioId: studioId! }, include: { user: true, contact: true } })
        : studioId
          ? await this.prisma.membership.findFirst({ where: { userId: ref.userId, studioId }, include: { user: true, contact: true } })
          : null;
    if ('membershipId' in ref && !membership) return null;
    const user = membership?.user ?? ('userId' in ref ? await this.prisma.user.findUnique({ where: { id: ref.userId } }) : null);
    if (!user) return null;
    const contact = membership?.contact ?? null;
    return {
      contactId: contact && !contact.mergedIntoId ? contact.id : null,
      userId: user.id,
      membershipId: membership?.id ?? null,
      firstName: user.firstName,
      phone: user.phone,
      email: user.email ?? contact?.email ?? null,
      locale: user.locale ?? contact?.locale ?? null,
      countryCode: contact?.countryCode ?? null,
      timezone: contact?.timezone ?? null,
    };
  }

  private async reserveSmsCredit(studioId: string): Promise<{ walletId: string; balanceAfter: number } | null> {
    const wallet = await this.prisma.smsWallet.findUnique({ where: { studioId } });
    if (!wallet) return null;
    const reserved = await this.prisma.smsWallet.updateMany({
      where: { studioId, balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    if (reserved.count === 0) return null;
    const updated = await this.prisma.smsWallet.findUniqueOrThrow({ where: { studioId } });
    return { walletId: wallet.id, balanceAfter: updated.balance };
  }

  private async finish(
    logId: string,
    status: NotificationStatus,
    provider: string,
    providerMessageId: string | undefined,
    errorMessage: string | undefined,
  ): Promise<void> {
    await this.prisma.notificationLog.update({
      where: { id: logId },
      data: { status, provider, providerMessageId: providerMessageId ?? null, errorMessage: errorMessage ?? null },
    });
  }

  private async appendToConversation(
    ctx: AttemptContext,
    log: NotificationLog,
    text: string,
    status: string,
    provider: string,
    providerMessageId: string | undefined,
  ): Promise<void> {
    const conversationId = ctx.input.conversationId;
    if (!conversationId || !ctx.input.studioId) return;
    await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: {
          studioId: ctx.input.studioId,
          conversationId,
          direction: 'OUT',
          body: ctx.input.sensitive ? REDACTED : text,
          provider,
          providerMessageId: providerMessageId ?? null,
          status,
          authorMembershipId: ctx.input.authorMembershipId ?? null,
          notificationLogId: log.id,
        },
      }),
      this.prisma.conversation.updateMany({
        where: { id: conversationId, studioId: ctx.input.studioId },
        data: { lastMessageAt: new Date(), lastMessagePreview: text.slice(0, 200) },
      }),
    ]);
  }
}

function stringParams(variables: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, String(v)]));
}

/** Channels a NotificationLog row can carry, for code that maps back from the database enum. */
export function isEngineChannel(channel: NotificationChannel): channel is EngineChannel {
  return ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'].includes(channel);
}
