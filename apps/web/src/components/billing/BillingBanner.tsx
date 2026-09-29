import Link from 'next/link';
import type { MembershipBillingSummary } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';
import { billingBannerFor } from '@/lib/billing/banner';

/**
 * Days-left / restricted-mode band at the top of every dashboard page
 * (G5c-1). Only the owner holds billing.manage, so only the owner gets the
 * "Hesabı etkinleştir" link; other staff are told who can activate.
 * Design tokens only: a muted surface with the brand color as the accent.
 */
export async function BillingBanner({ billing, canActivate }: { billing: MembershipBillingSummary | undefined; canActivate: boolean }) {
  const banner = billingBannerFor(billing);
  if (!banner) return null;
  const { t } = await getT();

  const text =
    banner.kind === 'trial'
      ? t('billing.banner.trialDaysLeft', { count: banner.daysLeft })
      : banner.kind === 'trialEndsToday'
        ? t('billing.banner.trialEndsToday')
        : t(`billing.banner.${banner.kind}`);
  const urgent = banner.kind !== 'trial';

  return (
    <section
      aria-label={t('billing.page.title')}
      data-testid="billing-banner"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border"
      style={{
        borderRadius: 'var(--radius-card)',
        borderColor: urgent ? 'var(--color-primary)' : 'var(--color-border)',
        borderLeftWidth: 4,
        borderLeftColor: 'var(--color-primary)',
        backgroundColor: 'var(--color-surface-muted)',
        color: 'var(--color-text-primary)',
      }}
    >
      <p className="text-sm font-medium">{text}</p>
      {canActivate ? (
        <Link
          href="/abonelik"
          className="text-xs font-semibold px-3.5 py-2"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {t('billing.banner.cta')}
        </Link>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t('billing.banner.askOwner')}
        </p>
      )}
    </section>
  );
}
