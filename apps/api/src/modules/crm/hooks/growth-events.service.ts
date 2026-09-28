import { Injectable, Logger } from '@nestjs/common';
import type { JourneyEventTrigger } from '@platform/shared';

/** Something happened to a contact that a journey may start on (docs/KAMPANYA_VE_AKISLAR.md). */
export interface GrowthEvent {
  studioId: string;
  contactId: string;
  event: JourneyEventTrigger;
  /** Business record behind the event (booking id, conversion id, ...): the enrollment idempotency key. */
  ref: string;
  occurredAt: Date;
  /** Template variables the event can offer to a journey's messages. */
  variables?: Record<string, string>;
}

export type GrowthEventHandler = (event: GrowthEvent) => Promise<void>;

/**
 * In-process fan-out of contact events to the journey engine. It lives in
 * CrmCoreModule, which every business module can already import, so the
 * producers (conversions, bookings, tags, inbound messages) do not depend
 * on the journeys module and no import cycle appears. Handlers never throw
 * into the producer: a failed enrollment is logged and the business flow
 * (a booking, a payment) always completes.
 */
@Injectable()
export class GrowthEventsService {
  private readonly logger = new Logger(GrowthEventsService.name);
  private readonly handlers: GrowthEventHandler[] = [];

  subscribe(handler: GrowthEventHandler): void {
    this.handlers.push(handler);
  }

  async emit(event: GrowthEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.warn(`Growth event ${event.event} not handled: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
