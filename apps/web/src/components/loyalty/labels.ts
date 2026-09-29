import { LOYALTY_ERROR_CODES } from '@platform/shared';
import type { LoyaltyRewardDTO, LoyaltyRuleDTO, Translate } from '@platform/shared';
import { BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';

/** A loyalty API error in the viewer's language: the stable `code` first, then the API text. */
export function loyaltyErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof BffError) {
    if (err.code && (LOYALTY_ERROR_CODES as readonly string[]).includes(err.code)) return t(`loyalty.error.${err.code}`);
    return err.message;
  }
  return t('loyalty.error.generic');
}

/** One line describing what a reward gives (amounts always with their currency). */
export function rewardSummary(t: Translate, reward: Pick<LoyaltyRewardDTO, 'type' | 'value' | 'currency'>, locale: string): string {
  switch (reward.type) {
    case 'DISCOUNT_AMOUNT':
      return t('loyalty.rewards.summary.DISCOUNT_AMOUNT', { value: reward.currency ? formatMoney(reward.value, reward.currency, locale) : (reward.value ?? '') });
    case 'DISCOUNT_PERCENT':
      return t('loyalty.rewards.summary.DISCOUNT_PERCENT', { value: Number(reward.value ?? 0).toLocaleString(locale) });
    case 'EXTRA_SESSION_CREDIT':
      return t('loyalty.rewards.summary.EXTRA_SESSION_CREDIT', { value: Number(reward.value ?? 0).toLocaleString(locale) });
    case 'GIFT':
      return t('loyalty.rewards.summary.GIFT');
  }
}

/** One line describing what a rule gives. */
export function ruleSummary(t: Translate, rule: Pick<LoyaltyRuleDTO, 'kind' | 'points' | 'perAmount' | 'currency'>, locale: string): string {
  const points = t('loyalty.points', { count: rule.points });
  if (rule.kind === 'PURCHASE_AMOUNT' && rule.perAmount && rule.currency) {
    return t('loyalty.rules.purchaseSummary', { points, amount: formatMoney(rule.perAmount, rule.currency, locale) });
  }
  return points;
}

/** A fresh key per submitted form: a retried request never adjusts or redeems twice. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
