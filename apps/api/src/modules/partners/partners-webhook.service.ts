import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@platform/database';
import { PartnerWebhookPayloadSchema, type PartnerConnectionCredentials } from '@platform/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerConnectionsService } from './partner-connections.service';
import { PartnerReservationsService, type PartnerBookingResult } from './partner-reservations.service';
import { PartnerProviderRegistry } from './providers/partner-provider.registry';

/**
 * Inbound webhook processing: verify the HMAC signature (constant-time,
 * per-provider adapter), enforce the 5 minute timestamp tolerance (delegated
 * to the adapter), record the event id for replay protection, then dispatch
 * to PartnerReservationsService. Every failure path throws before any
 * booking-affecting write happens.
 */
@Injectable()
export class PartnersWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: PartnerConnectionsService,
    private readonly reservations: PartnerReservationsService,
    private readonly registry: PartnerProviderRegistry,
  ) {}

  async handle(
    providerParam: string,
    connectionId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<PartnerBookingResult> {
    const connection = await this.prisma.partnerConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.provider.toLowerCase() !== providerParam.toLowerCase()) {
      throw new NotFoundException('Partner bağlantısı bulunamadı');
    }

    const credentials = await this.connections.getDecryptedCredentials(connectionId);
    if (!credentials) {
      throw new BadRequestException('Partner bağlantısı için kimlik bilgisi yapılandırılmamış');
    }

    const adapter = this.registry.get(connection.provider);
    const signatureHeader = headerValue(headers['x-partner-signature']);
    const timestampHeader = headerValue(headers['x-partner-timestamp']);
    const verification = adapter.verifyWebhookSignature(
      credentials as PartnerConnectionCredentials,
      rawBody,
      signatureHeader,
      timestampHeader,
      new Date(),
    );
    if (!verification.valid) {
      throw new BadRequestException(`Geçersiz webhook imzası: ${verification.reason ?? 'bilinmiyor'}`);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Geçersiz JSON gövdesi');
    }
    const payload = PartnerWebhookPayloadSchema.parse(parsedBody);

    // Replay protection: the partner's eventId is unique per connection. A
    // re-delivery (network retry, at-least-once webhook semantics) hits the
    // unique constraint and is treated as already-processed, not an error.
    try {
      await this.prisma.partnerWebhookEvent.create({
        data: {
          studioId: connection.studioId,
          connectionId,
          eventId: payload.eventId,
          eventType: payload.eventType,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.lookupOutcome(connectionId, payload.externalReservationId);
      }
      throw err;
    }

    switch (payload.eventType) {
      case 'RESERVATION_CREATED':
        return this.reservations.createReservation(connection.studioId, connectionId, payload);
      case 'RESERVATION_CANCELLED':
        return this.reservations.cancelReservation(connection.studioId, connectionId, payload);
      case 'CHECK_IN':
        return this.reservations.recordCheckIn(connection.studioId, connectionId, payload);
      default:
        throw new BadRequestException('Bilinmeyen olay türü');
    }
  }

  private async lookupOutcome(connectionId: string, externalReservationId: string): Promise<PartnerBookingResult> {
    const booking = await this.prisma.booking.findFirst({
      where: { partnerConnectionId: connectionId, externalReservationId },
    });
    if (!booking) {
      // Event was already recorded but produced no booking (should not
      // normally happen); report it as idempotently handled regardless.
      return { bookingId: '', status: 'UNKNOWN', idempotent: true };
    }
    return { bookingId: booking.id, status: booking.status, idempotent: true };
  }
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
