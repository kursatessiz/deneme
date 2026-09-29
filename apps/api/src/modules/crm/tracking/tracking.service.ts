import { Injectable } from '@nestjs/common';
import { STUDIO_REFERRAL_CODE_PATTERN, detectAdPlatform, isUntaggedPaidTraffic, parseReferralParam, parseTrackingParams } from '@platform/shared';
import type { TouchpointInput } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService } from '../attribution/attribution.service';
import { countryFromHeaders, deviceTypeOf, isLikelyBot, parseLanding, referrerHostOf } from './tracking-utils';

export interface TouchpointRequestMeta {
  userAgent: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export type TouchpointOutcome = 'stored' | 'no_consent' | 'bot' | 'unknown_studio' | 'invalid_url';

/**
 * Stores one touchpoint per call (docs/CRM_VE_ATIF.md "Ziyaret takibi").
 * Consent gating happens here, not only in the browser:
 * - consent.analytics false: nothing is stored at all
 * - consent.advertising false: click ids and the Meta fbp/fbc cookies are dropped
 * The landing URL is reduced to host + path; the IP address is never stored.
 */
@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
  ) {}

  async recordTouchpoint(studioSlug: string, input: TouchpointInput, meta: TouchpointRequestMeta, now = new Date()): Promise<TouchpointOutcome> {
    if (!input.consent.analytics) return 'no_consent';
    if (isLikelyBot(meta.userAgent)) return 'bot';

    const landing = parseLanding(input.landingUrl);
    if (!landing) return 'invalid_url';

    const studio = await this.prisma.studio.findFirst({ where: { slug: studioSlug, isActive: true }, select: { id: true } });
    if (!studio) return 'unknown_studio';

    // The body carries what the page read; the URL is the fallback source.
    const fromUrl = parseTrackingParams(input.landingUrl);
    const params = {
      utm: { ...fromUrl.utm, ...stripEmpty(input.utm) },
      adIds: { ...fromUrl.adIds, ...stripEmpty(input.adIds) },
      clickIds: { ...fromUrl.clickIds, ...stripEmpty(input.clickIds) },
    };
    const advertising = input.consent.advertising;
    const click = advertising ? params.clickIds : {};
    // Business referral code (G5c-1): a malformed code is dropped, never an error.
    const bodyRef = input.ref?.trim().toUpperCase();
    const refCode = bodyRef && STUDIO_REFERRAL_CODE_PATTERN.test(bodyRef) ? bodyRef : parseReferralParam(input.landingUrl);

    const visitor = await this.prisma.visitor.upsert({
      where: { studioId_id: { studioId: studio.id, id: input.visitorId } },
      create: { studioId: studio.id, id: input.visitorId, firstSeenAt: now, lastSeenAt: now },
      update: { lastSeenAt: now },
    });

    await this.prisma.touchpoint.create({
      data: {
        studioId: studio.id,
        visitorId: visitor.id,
        sessionId: input.sessionId,
        occurredAt: now,
        landingHost: landing.host,
        landingPath: landing.path,
        referrerHost: referrerHostOf(input.referrer, landing.host),
        utmSource: params.utm.utm_source ?? null,
        utmMedium: params.utm.utm_medium ?? null,
        utmCampaign: params.utm.utm_campaign ?? null,
        utmId: params.utm.utm_id ?? null,
        utmTerm: params.utm.utm_term ?? null,
        utmContent: params.utm.utm_content ?? null,
        adPlatform: detectAdPlatform(params),
        pwCid: params.adIds.pw_cid ?? null,
        pwAsid: params.adIds.pw_asid ?? null,
        pwAdid: params.adIds.pw_adid ?? null,
        pwPlc: params.adIds.pw_plc ?? null,
        fbclid: click.fbclid ?? null,
        gclid: click.gclid ?? null,
        gbraid: click.gbraid ?? null,
        wbraid: click.wbraid ?? null,
        ttclid: click.ttclid ?? null,
        liFatId: click.li_fat_id ?? null,
        msclkid: click.msclkid ?? null,
        fbp: advertising ? input.fbp ?? null : null,
        fbc: advertising ? input.fbc ?? null : null,
        locale: input.locale ?? null,
        countryCode: countryFromHeaders(meta.headers),
        deviceType: deviceTypeOf(meta.userAgent),
        pageVariant: input.pageVariant ?? null,
        isPaidUntagged: isUntaggedPaidTraffic(params),
        refCode,
        contactId: visitor.contactId,
      },
    });

    // An already identified visitor keeps its contact's last touch current.
    if (visitor.contactId) await this.attribution.refreshContactTouches(studio.id, visitor.contactId, now);
    return 'stored';
  }
}

function stripEmpty<T extends Record<string, string | undefined>>(values: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(values) as [keyof T, string | undefined][]) {
    if (value && value.trim()) out[key] = value.trim() as T[keyof T];
  }
  return out;
}
