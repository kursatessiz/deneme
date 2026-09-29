import { Injectable } from '@nestjs/common';
import { COMMERCIAL_SEND_WINDOW, complianceRegionOf, evaluateCommercialEligibility } from '@platform/shared';
import type { CommercialIneligibilityReason, ComplianceRegion, ConsentLegalBasis } from '@platform/shared';
import type { CanSendInput, CanSendResult } from './compliance.types';

/** Every region sends commercial messages only inside this local-time window (docs section 2.3: TCPA's 08:00-21:00, applied as the platform-wide default quiet hours). */
const QUIET_HOURS_START = COMMERCIAL_SEND_WINDOW.startHour;
const QUIET_HOURS_END = COMMERCIAL_SEND_WINDOW.endHour;

/**
 * Region-specific compliance rules for outbound messages
 * (docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.3). A pure function of its
 * input -- no DB or clock reads of its own -- so it is trivially
 * table-tested and safe to call from anywhere without a request context.
 * Transactional messages (booking confirmation, OTP) never need consent;
 * every commercial message needs an explicit, recorded opt-in and respects
 * the recipient's quiet hours.
 */
@Injectable()
export class ComplianceService {
  canSend(input: CanSendInput): CanSendResult {
    const region = complianceRegionOf(input.recipient.countryCode);

    if (input.purpose === 'TRANSACTIONAL') {
      return { allow: true, region };
    }

    if (input.recipient.optedOut) {
      return { allow: false, region, reasonCode: 'OPTED_OUT', reason: 'Alıcı bu kanaldan çıktı (STOP/abonelikten çık)' };
    }

    let basis: { legalBasis?: ConsentLegalBasis; legalBasisRecorded?: boolean } = {};
    const facts = input.recipient.legalBasis;
    if (facts && (input.channel === 'EMAIL' || input.channel === 'SMS' || input.channel === 'WHATSAPP')) {
      // M3e: the shared rule set decides the legal basis per region and channel (never a country in code).
      const decision = evaluateCommercialEligibility({ region, channel: input.channel, optedOut: false, ...facts });
      if (!decision.eligible) {
        return { allow: false, region, reasonCode: decision.reason, reason: this.ineligibleMessage(decision.reason, region) };
      }
      basis = { legalBasis: decision.basis, legalBasisRecorded: decision.recorded };
    } else if (!input.recipient.consentGranted) {
      return {
        allow: false,
        region,
        reasonCode: 'CONSENT_REQUIRED',
        reason: this.consentDeniedMessage(region),
      };
    }

    if (input.skipQuietHours) {
      return { allow: true, region, ...basis };
    }

    const timezone = input.recipient.timezone || input.studioTimezone || 'UTC';
    const now = input.now ?? new Date();
    if (!this.withinQuietHours(now, timezone)) {
      return {
        allow: false,
        region,
        reasonCode: 'QUIET_HOURS',
        reason: `Sessiz saatler dışında (${QUIET_HOURS_START}:00-${QUIET_HOURS_END}:00 alıcı yerel saati)`,
      };
    }

    return { allow: true, region, ...basis };
  }

  private ineligibleMessage(reason: CommercialIneligibilityReason, region: ComplianceRegion): string {
    switch (reason) {
      case 'DOUBLE_OPT_IN_PENDING':
        return 'Çift onay bekleniyor (onay bağlantısına henüz tıklanmadı)';
      case 'NO_LEGAL_BASIS':
        return 'Alıcının bölgesinde geçerli bir izin dayanağı yok';
      case 'TR_EXEMPTION_DISABLED':
        return 'Tacir muafiyeti kapalı ve açık onay yok';
      case 'OPTED_OUT':
        return 'Alıcı bu kanaldan çıktı (STOP/abonelikten çık)';
      default:
        return this.consentDeniedMessage(region);
    }
  }

  private consentDeniedMessage(region: ComplianceRegion): string {
    switch (region) {
      case 'TR':
        return 'KVKK/İYS ticari ileti onayı yok';
      case 'EU':
      case 'UK':
        return 'GDPR açık rızası yok';
      case 'US':
        return 'TCPA açık yazılı onayı yok';
      default:
        return 'Açık rıza yok';
    }
  }

  /** True when `now`, read in `timezone`, falls in [QUIET_HOURS_START, QUIET_HOURS_END). Accounts for DST via Intl. */
  private withinQuietHours(now: Date, timezone: string): boolean {
    let hour: number;
    try {
      const formatted = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now);
      hour = Number(formatted);
    } catch {
      // Unknown/invalid timezone: fail safe to UTC rather than throwing, so a bad tenant timezone never blocks every send.
      hour = now.getUTCHours();
    }
    return hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END;
  }
}
