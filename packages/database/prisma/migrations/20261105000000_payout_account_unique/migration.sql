-- A provider account (for example a Stripe connected account acct_...) may be
-- connected to one studio only; otherwise a studio could read another studio's
-- payouts. Expand-only: a partial unique index, no column changes.
-- If this fails on existing data, resolve the duplicate rows first.
CREATE UNIQUE INDEX "payout_connections_provider_account_unique"
  ON "payout_connections" ("provider", "provider_account_id")
  WHERE "provider_account_id" IS NOT NULL;
