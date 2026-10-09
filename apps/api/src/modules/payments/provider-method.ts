import { PaymentMethod, PaymentProvider } from '@platform/database';

/**
 * Single mapping from a payment provider to the payment method recorded on the
 * Payment row. MOCK settles like a card-present charge.
 */
export const PROVIDER_PAYMENT_METHOD: Record<PaymentProvider, PaymentMethod> = {
  [PaymentProvider.MOCK]: PaymentMethod.CREDIT_CARD_POS,
  [PaymentProvider.IYZICO]: PaymentMethod.ONLINE_IYZICO,
  [PaymentProvider.PAYTR]: PaymentMethod.ONLINE_PAYTR,
  [PaymentProvider.STRIPE]: PaymentMethod.ONLINE_STRIPE,
};

/** Provider behind each online checkout method; the inverse of PROVIDER_PAYMENT_METHOD for ONLINE_* methods. */
const ONLINE_METHOD_PROVIDER: Partial<Record<PaymentMethod, PaymentProvider>> = {
  [PaymentMethod.ONLINE_IYZICO]: PaymentProvider.IYZICO,
  [PaymentMethod.ONLINE_PAYTR]: PaymentProvider.PAYTR,
  [PaymentMethod.ONLINE_STRIPE]: PaymentProvider.STRIPE,
};

/** The provider an ONLINE_* method is settled through, or undefined for any other method. */
export function providerForOnlineMethod(method: PaymentMethod): PaymentProvider | undefined {
  return ONLINE_METHOD_PROVIDER[method];
}

/**
 * The method a member's online checkout through `provider` is stored with.
 * The mock provider stands in for the default online processor and keeps the
 * historical ONLINE_IYZICO label.
 */
export function onlineCheckoutMethod(provider: PaymentProvider): PaymentMethod {
  return provider === PaymentProvider.MOCK ? PaymentMethod.ONLINE_IYZICO : PROVIDER_PAYMENT_METHOD[provider];
}
