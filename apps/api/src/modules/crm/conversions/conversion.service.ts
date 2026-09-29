import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@platform/database';
import type { ConversionEvent as ConversionEventRow } from '@platform/database';
import { ConversionEventSchema } from '@platform/shared';
import type { ConversionEventType } from '@platform/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService } from '../attribution/attribution.service';
import { ConversionOutboxService } from './conversion-outbox.service';
import { GrowthEventsService } from '../hooks/growth-events.service';

export interface RecordConversionInput {
  studioId: string;
  type: ConversionEventType;
  contactId: string;
  occurredAt?: Date;
  value?: { amount: string; currency: string };
  /** Business record the event comes from; (studioId, kind, id) makes record() idempotent. */
  source: { kind: string; id: string };
  isTest?: boolean;
  /** Browser pixel event id, when the page fired one; derived from the source otherwise. */
  eventId?: string;
  /**
   * Touchpoint to credit when no touch falls inside the attribution window
   * before the event (G5c-1: studio_paid falls back to the touchpoint the
   * studio's signup was attributed to).
   */
  fallbackTouchpointId?: string | null;
}

export interface RecordConversionResult {
  event: ConversionEventRow;
  created: boolean;
}

const PLATFORM_ONLY: ReadonlySet<ConversionEventType> = new Set(['studio_signup', 'studio_paid']);

/** Stable event id: the same business record always yields the same id. */
export function deriveEventId(studioId: string, type: ConversionEventType, kind: string, id: string): string {
  const digest = createHash('sha256').update(`${studioId}:${kind}:${id}`).digest('hex').slice(0, 40);
  return `${type}.${digest}`;
}

/**
 * Conversion events (docs/CRM_VE_ATIF.md). record() is idempotent on
 * (studioId, sourceKind, sourceId): a retried hook, a double-submitted form
 * or a re-delivered payment webhook returns the existing row. Callers in
 * business flows use recordSafely(), which never throws.
 */
@Injectable()
export class ConversionService {
  private readonly logger = new Logger(ConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
    private readonly outbox: ConversionOutboxService,
    private readonly events: GrowthEventsService,
  ) {}

  async record(input: RecordConversionInput): Promise<RecordConversionResult> {
    const occurredAt = input.occurredAt ?? new Date();
    const eventId = input.eventId ?? deriveEventId(input.studioId, input.type, input.source.kind, input.source.id);

    const parsed = ConversionEventSchema.safeParse({
      eventId,
      type: input.type,
      occurredAt: occurredAt.toISOString(),
      contactId: input.contactId,
      value: input.value,
      source: input.source,
      isTest: input.isTest ?? false,
    });
    if (!parsed.success) {
      throw new BadRequestException(`Geçersiz dönüşüm olayı: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    }

    const existing = await this.findBySource(input.studioId, input.source.kind, input.source.id);
    if (existing) return { event: existing, created: false };

    const [studio, contact] = await Promise.all([
      this.prisma.studio.findUnique({ where: { id: input.studioId }, select: { isPlatform: true } }),
      this.prisma.contact.findFirst({
        where: { id: input.contactId, studioId: input.studioId },
        select: { id: true, isTest: true },
      }),
    ]);
    if (!studio) throw new BadRequestException('İşletme bulunamadı');
    if (!contact) throw new BadRequestException('Kişi bu işletmede bulunamadı');
    if (PLATFORM_ONLY.has(input.type) && !studio.isPlatform) {
      throw new BadRequestException('Bu dönüşüm türü yalnızca platform kiracısında kaydedilir');
    }

    const lastTouch = await this.attribution.lastTouchFor(input.studioId, contact.id, occurredAt);
    const isTest = parsed.data.isTest || contact.isTest;

    let event: ConversionEventRow;
    try {
      event = await this.prisma.conversionEvent.create({
        data: {
          studioId: input.studioId,
          eventId,
          type: input.type,
          occurredAt,
          contactId: contact.id,
          valueAmount: input.value ? new Prisma.Decimal(input.value.amount) : null,
          currency: input.value?.currency ?? null,
          sourceKind: input.source.kind,
          sourceId: input.source.id,
          isTest,
          attributedTouchpointId: lastTouch?.id ?? input.fallbackTouchpointId ?? null,
        },
      });
    } catch (err) {
      // A concurrent record() of the same source (or event id) won the race.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findBySource(input.studioId, input.source.kind, input.source.id);
        if (winner) return { event: winner, created: false };
      }
      throw err;
    }

    await this.outbox.enqueue({ id: event.id, studioId: event.studioId, isTest: event.isTest });
    // Journeys may start on any funnel event (lead, trial_booked, purchase, ...).
    await this.events.emit({ studioId: event.studioId, contactId: event.contactId, event: input.type, ref: event.id, occurredAt: event.occurredAt });
    return { event, created: true };
  }

  /** Business-flow entry point: logs and swallows every failure. */
  async recordSafely(input: RecordConversionInput): Promise<RecordConversionResult | null> {
    try {
      return await this.record(input);
    } catch (err) {
      this.logger.warn(
        `Conversion ${input.type} for ${input.source.kind}:${input.source.id} not recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Platform tenant: a new studio account was created. Recorded only when
   * the platform CRM already knows the owner's phone (e.g. from a landing
   * page form), so the ad click that brought them in gets the credit.
   */
  async recordStudioSignup(newStudioId: string, ownerPhone: string, occurredAt = new Date()) {
    const platform = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!platform || platform.id === newStudioId) return null;
    const contact = await this.prisma.contact.findFirst({
      where: { studioId: platform.id, phone: ownerPhone, mergedIntoId: null },
      select: { id: true, lifecycleStage: true },
    });
    if (!contact) return null;
    const result = await this.recordSafely({
      studioId: platform.id,
      type: 'studio_signup',
      contactId: contact.id,
      occurredAt,
      source: { kind: 'studio', id: newStudioId },
    });
    if (result?.created && (contact.lifecycleStage === 'LEAD' || contact.lifecycleStage === 'LOST')) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { lifecycleStage: 'TRIAL' } });
    }
    return result;
  }

  /**
   * Platform tenant: a studio paid a platform invoice (G5c-1 activation).
   * The owner is looked up through the studio's owner membership. The
   * event is attributed like any other (last touch inside the window before
   * the payment); when there is none, for example a long trial, it falls
   * back to the touchpoint the studio_signup event was attributed to, so
   * the ad that brought the business in gets the paid conversion. Callers
   * pass a reference keyed on the studio to record it once per studio.
   */
  async recordStudioPaid(
    paidStudioId: string,
    reference: { kind: string; id: string },
    value: { amount: string; currency: string },
    occurredAt = new Date(),
  ) {
    const platform = await this.prisma.studio.findFirst({ where: { isPlatform: true }, select: { id: true } });
    if (!platform) return null;
    const owner = await this.prisma.membership.findFirst({
      where: { studioId: paidStudioId, roleTemplate: { isOwner: true } },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { phone: true } } },
    });
    if (!owner) return null;
    const contact = await this.prisma.contact.findFirst({
      where: { studioId: platform.id, phone: owner.user.phone, mergedIntoId: null },
      select: { id: true },
    });
    if (!contact) return null;
    const signup = await this.findBySource(platform.id, 'studio', paidStudioId);
    const result = await this.recordSafely({
      studioId: platform.id,
      type: 'studio_paid',
      contactId: contact.id,
      occurredAt,
      value,
      source: reference,
      fallbackTouchpointId: signup?.attributedTouchpointId ?? null,
    });
    if (result?.created) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { lifecycleStage: 'MEMBER' } });
    }
    return result;
  }

  private findBySource(studioId: string, kind: string, id: string) {
    return this.prisma.conversionEvent.findUnique({
      where: { studioId_sourceKind_sourceId: { studioId, sourceKind: kind, sourceId: id } },
    });
  }
}
