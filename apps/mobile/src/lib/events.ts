import { EVENT_ERROR_CODES } from '@platform/shared';
import type { EventTicketTypeDTO, Translate } from '@platform/shared';

import { formatCurrency } from '../i18n';
import { ApiError } from './api';

/** An events API error in the viewer's language (stable `code` first, generic otherwise). */
export function eventErrorText(e: unknown, t: Translate): string {
  if (e instanceof ApiError && e.code && (EVENT_ERROR_CODES as readonly string[]).includes(e.code)) return t(`mEvents.error.${e.code}`);
  return t('mEvents.error.generic');
}

/** Ticket price with its own currency, or "free". Money arrives as a decimal string and is only formatted here. */
export function ticketPriceLabel(ticket: Pick<EventTicketTypeDTO, 'priceAmount' | 'currency'>, locale: string, t: Translate): string {
  const amount = Number(ticket.priceAmount);
  return amount > 0 ? formatCurrency(amount, locale, ticket.currency) : t('mEvents.free');
}
