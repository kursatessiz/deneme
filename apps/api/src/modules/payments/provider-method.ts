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
