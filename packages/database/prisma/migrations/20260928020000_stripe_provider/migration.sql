-- G1a: add the global default payment provider (Stripe) to the enum.
-- Forward-only: ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value, which is fine here since nothing else
-- in this migration references it.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'STRIPE';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ONLINE_STRIPE';
