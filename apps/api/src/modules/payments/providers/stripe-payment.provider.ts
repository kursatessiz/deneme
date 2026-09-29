import { Injectable, InternalServerErrorException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { PaymentProvider } from '@platform/database';
import { amountToMinor, currencyMinorUnitDigits, minorToAmount, toMinorUnits } from '@platform/shared';
import type { ProviderChargeResult, ProviderCheckoutResult } from '@platform/shared';
import type {
  ChargeStoredCardParams,
  CreateCheckoutParams,
  ListPayoutItemsParams,
  ListPayoutsParams,
  PaymentProviderAdapter,
  ProviderPayout,
  ProviderPayoutItem,
  ProviderPayoutItemType,
  ProviderPayoutStatus,
  RefundParams,
  WebhookVerificationResult,
} from './payment-provider.interface';
import { PayoutNotConfiguredError } from './payment-provider.interface';

/** Stripe integer minor units to a decimal string in the currency's own digits (0, 2 or 3). */
export function stripeMinorToDecimal(minor: number, currency: string): string {
  const digits = currencyMinorUnitDigits(currency);
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const text = abs.toString().padStart(digits + 1, '0');
  const value = digits === 0 ? text : `${text.slice(0, text.length - digits)}.${text.slice(text.length - digits)}`;
  // Stored amounts have at most two decimals; normalise through the shared money helpers.
  const minorUnits = amountToMinor(value, currency);
  return minorToAmount(negative ? -minorUnits : minorUnits, currency);
}

const STRIPE_PAYOUT_STATUS: Record<string, ProviderPayoutStatus> = {
  pending: 'PENDING',
  in_transit: 'IN_TRANSIT',
  paid: 'PAID',
  failed: 'FAILED',
  canceled: 'CANCELED',
};

const STRIPE_CHARGE_TYPES = new Set(['charge', 'payment']);
const STRIPE_REFUND_TYPES = new Set(['refund', 'payment_refund']);
const STRIPE_FEE_TYPES = new Set(['stripe_fee', 'network_cost', 'application_fee']);
/** Balance transactions that are the payout itself, not something inside it. */
const STRIPE_PAYOUT_TYPES = new Set(['payout', 'payout_cancel', 'payout_failure']);

function stripeItemType(type: string): ProviderPayoutItemType {
  if (STRIPE_CHARGE_TYPES.has(type)) return 'CHARGE';
  if (STRIPE_REFUND_TYPES.has(type)) return 'REFUND';
  if (STRIPE_FEE_TYPES.has(type)) return 'FEE';
  return 'ADJUSTMENT';
}

/**
 * Stripe adapter: the platform's global default payment provider (see
 * docs/BUYUME_VE_GLOBAL_MIMARI.md section 2.2). Card payments via Checkout
 * Sessions, stored cards via a Customer + saved PaymentMethod, subscription
 * renewals via off-session PaymentIntents against that saved method, and
 * refunds via the Refunds API. Runs as a deterministic mock -- exactly like
 * every other adapter in this codebase -- whenever STRIPE_SECRET_KEY is not
 * configured, so local dev and tests never need a real Stripe account.
 *
 * `ChargeStoredCardParams.cardToken` stores a Stripe customer id and saved
 * payment method id as `${customerId}:${paymentMethodId}`; that composite
 * is what `createCheckout`'s completed session hands back as the token to
 * save (see `cardToken` on ProviderChargeResult), since this platform's
 * stored-card model has only a single opaque token field.
 */
@Injectable()
export class StripePaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.STRIPE;
  private readonly logger = new Logger(StripePaymentProvider.name);
  private client: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  /** A real sync must name the studio's connected account: the platform key would otherwise read the platform's own payouts. */
  get payoutsNeedAccountId(): boolean {
    return this.isConfigured;
  }

  private get isConfigured(): boolean {
    return !!this.config.get<string>('STRIPE_SECRET_KEY');
  }

  /**
   * Without credentials the adapter simulates success, which is only safe
   * outside production. In production it refuses instead, so a missing key
   * can never turn a sale into a free package.
   */
  private assertMockAllowed(): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException('Stripe yapılandırılmamış; ödeme alınamıyor.');
    }
  }

  private get stripe(): Stripe {
    if (!this.client) {
      const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!secretKey) throw new InternalServerErrorException('Stripe yapılandırılmamış: STRIPE_SECRET_KEY gereklidir');
      this.client = new Stripe(secretKey);
    }
    return this.client;
  }

  async createCheckout(params: CreateCheckoutParams): Promise<ProviderCheckoutResult> {
    if (!this.isConfigured) {
      this.assertMockAllowed();
      this.logger.log(`[MOCK Stripe] Simulated checkout for ${params.reference}`);
      return { providerReference: `mock_stripe_chk_${randomUUID()}`, status: 'COMPLETED' };
    }

    const successUrl = this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL') ?? 'https://example.com/checkout/success';
    const cancelUrl = this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL') ?? 'https://example.com/checkout/cancel';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: params.reference,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: toMinorUnits(params.amount, params.currency),
            product_data: { name: params.description },
          },
        },
      ],
      metadata: { studioId: params.studioId, memberId: params.memberId, reference: params.reference },
    });

    return { providerReference: session.id, status: 'PENDING', checkoutUrl: session.url ?? undefined };
  }

  async chargeStoredCard(params: ChargeStoredCardParams): Promise<ProviderChargeResult> {
    if (!this.isConfigured) {
      this.assertMockAllowed();
      return { success: true, providerReference: `mock_stripe_chg_${randomUUID()}` };
    }

    const [customerId, paymentMethodId] = params.cardToken.split(':');
    if (!customerId || !paymentMethodId) {
      return { success: false, providerReference: `stripe_chg_${randomUUID()}`, failureCode: 'invalid_card_token' };
    }

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: toMinorUnits(params.amount, params.currency),
        currency: params.currency.toLowerCase(),
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: params.description,
        metadata: { studioId: params.studioId, memberId: params.memberId, reference: params.reference },
      });
      if (intent.status === 'succeeded') {
        return { success: true, providerReference: intent.id };
      }
      return { success: false, providerReference: intent.id, failureCode: intent.status };
    } catch (err) {
      const stripeErr = err as Stripe.errors.StripeError;
      return {
        success: false,
        providerReference: `stripe_chg_${randomUUID()}`,
        failureCode: stripeErr.code ?? 'stripe_error',
        failureMessage: stripeErr.message,
      };
    }
  }

  async refund(params: RefundParams): Promise<ProviderChargeResult> {
    if (!this.isConfigured) {
      this.assertMockAllowed();
      return { success: true, providerReference: `mock_stripe_rfnd_${randomUUID()}` };
    }
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: params.providerReference,
        amount: toMinorUnits(params.amount, params.currency),
        reason: 'requested_by_customer',
      });
      return { success: refund.status === 'succeeded' || refund.status === 'pending', providerReference: refund.id };
    } catch (err) {
      const stripeErr = err as Stripe.errors.StripeError;
      return { success: false, providerReference: `stripe_rfnd_${randomUUID()}`, failureMessage: stripeErr.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Payouts (G5d-2): Stripe payouts and the balance transactions inside them,
  // read from the studio's connected account.
  // ---------------------------------------------------------------------------

  async listPayouts(params: ListPayoutsParams): Promise<ProviderPayout[]> {
    if (!this.isConfigured) {
      this.assertMockAllowed();
      return [];
    }
    const options = this.accountOptions(params.accountId);
    const out: ProviderPayout[] = [];
    const list = this.stripe.payouts.list({ arrival_date: { gte: Math.floor(params.since.getTime() / 1000) }, limit: 100 }, options);
    for await (const payout of list) {
      const currency = payout.currency.toUpperCase();
      out.push({
        providerPayoutId: payout.id,
        status: STRIPE_PAYOUT_STATUS[payout.status] ?? 'PENDING',
        arrivalDate: new Date(payout.arrival_date * 1000),
        netAmount: stripeMinorToDecimal(payout.amount, currency),
        currency,
      });
    }
    return out;
  }

  async listPayoutItems(params: ListPayoutItemsParams): Promise<ProviderPayoutItem[]> {
    if (!this.isConfigured) {
      this.assertMockAllowed();
      return [];
    }
    const options = this.accountOptions(params.accountId);
    const items: ProviderPayoutItem[] = [];
    const list = this.stripe.balanceTransactions.list({ payout: params.providerPayoutId, expand: ['data.source'], limit: 100 }, options);
    for await (const txn of list) {
      if (STRIPE_PAYOUT_TYPES.has(txn.type)) continue;
      const currency = txn.currency.toUpperCase();
      const type = stripeItemType(txn.type);
      const { providerReference, relatedReference } = await this.itemReferences(txn, type, options);
      items.push({
        providerItemId: txn.id,
        type,
        providerReference,
        relatedReference,
        amount: stripeMinorToDecimal(txn.amount, currency),
        fee: stripeMinorToDecimal(txn.fee, currency),
        net: stripeMinorToDecimal(txn.net, currency),
        currency,
        occurredAt: new Date(txn.created * 1000),
        description: txn.description ? txn.description.slice(0, 200) : null,
      });
    }
    return items;
  }

  private accountOptions(accountId: string | null | undefined): Stripe.RequestOptions {
    if (!accountId) {
      throw new PayoutNotConfiguredError('Stripe bağlı hesap kimliği (providerAccountId) tanımlı değil');
    }
    return { stripeAccount: accountId };
  }

  /**
   * The references our Payment can carry: a charge is matched by its
   * PaymentIntent id (card sales) or the Checkout Session that created it
   * (online checkout stores the session id); a refund by the original
   * payment intent. The session lookup is best effort: without it the item
   * simply stays unmatched.
   */
  private async itemReferences(
    txn: Stripe.BalanceTransaction,
    type: ProviderPayoutItemType,
    options: Stripe.RequestOptions,
  ): Promise<{ providerReference: string | null; relatedReference: string | null }> {
    const source = txn.source;
    if (!source) return { providerReference: null, relatedReference: null };
    if (typeof source === 'string') return { providerReference: source, relatedReference: null };

    if (type === 'CHARGE' && 'payment_intent' in source) {
      const charge = source as Stripe.Charge;
      const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id ?? null);
      let sessionId: string | null = null;
      if (intentId) {
        try {
          const sessions = await this.stripe.checkout.sessions.list({ payment_intent: intentId, limit: 1 }, options);
          sessionId = sessions.data[0]?.id ?? null;
        } catch (err) {
          this.logger.warn(`Stripe checkout session lookup failed for ${intentId}: ${(err as Error).message}`);
        }
      }
      return { providerReference: intentId ?? charge.id, relatedReference: sessionId ?? (intentId ? charge.id : null) };
    }
    if (type === 'REFUND' && 'payment_intent' in source) {
      const refund = source as Stripe.Refund;
      const intentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : (refund.payment_intent?.id ?? null);
      const chargeId = typeof refund.charge === 'string' ? refund.charge : (refund.charge?.id ?? null);
      return { providerReference: refund.id, relatedReference: intentId ?? chargeId };
    }
    return { providerReference: source.id ?? null, relatedReference: null };
  }

  /** Verifies Stripe's signature against the exact raw request body (see common/body-parsers.ts). */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerificationResult {
    if (!this.isConfigured) return { valid: false };
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    const signature = headers['stripe-signature'];
    if (!secret || !signature || Array.isArray(signature)) return { valid: false };

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature rejected: ${(err as Error).message}`);
      return { valid: false };
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          valid: true,
          eventType: 'CHECKOUT_COMPLETED',
          providerReference: session.id,
          amount: session.amount_total ? session.amount_total / 100 : undefined,
        };
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        return { valid: true, eventType: 'CHARGE_SUCCEEDED', providerReference: intent.id, amount: intent.amount / 100 };
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        return {
          valid: true,
          eventType: 'CHARGE_FAILED',
          providerReference: intent.id,
          failureCode: intent.last_payment_error?.code,
        };
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        return { valid: true, eventType: 'REFUND_COMPLETED', providerReference: charge.payment_intent as string };
      }
      default:
        return { valid: false };
    }
  }
}
