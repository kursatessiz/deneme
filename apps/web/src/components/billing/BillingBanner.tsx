import type { MembershipBillingSummary } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';
import { billingBannerFor } from '@/lib/billing/banner';
import { LinkButton } from '@/components/ui/LinkButton';

/**
 * Days-left / restricted-mode band at the top of every dashboard page
 * (G5c-1). Only the owner holds billing.manage, so only the owner gets the
 * "Hesabı etkinleştir" link; other staff are told who can activate.
 * A muted card with the brand color as the accent (ui-banner).
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
      className="pui-card ui-banner mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      data-urgent={urgent}
    >
      <p className="ui-strong">{text}</p>
      {canActivate ? (
        <LinkButton size="sm" href="/abonelik">
          {t('billing.banner.cta')}
        </LinkButton>
      ) : (
        <p className="ui-caption">
          {t('billing.banner.askOwner')}
        </p>
      )}
    </section>
  );
}
