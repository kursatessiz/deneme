'use client';

import { useState } from 'react';
import { describeUnitExpiry, describeUsagePeriods, usageQuotaNoun } from '@platform/shared';
import type { PackageUnitExpiryDTO, UsagePeriodStatusDTO } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface UsagePeriodStatusProps {
  studioId: string;
  memberPackageId: string;
  entitlementKind: string;
  packageEnd: string;
  usagePeriods: readonly UsagePeriodStatusDTO[] | null | undefined;
  expiredUnits?: number;
}

/**
 * Current period of each tier of a member package on the staff member card: used/quota, renewal date, a
 * burn or cap badge, and the burned total with an expander listing the burn history.
 */
export function UsagePeriodStatus({ studioId, memberPackageId, entitlementKind, packageEnd, usagePeriods, expiredUnits = 0 }: UsagePeriodStatusProps) {
  const t = useT();
  const locale = useLocale();
  const [history, setHistory] = useState<PackageUnitExpiryDTO[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usagePeriods || usagePeriods.length === 0) return null;
  const now = new Date();
  const lines = describeUsagePeriods(t, usagePeriods, { locale, now, entitlementKind, packageEnd });

  async function toggleHistory() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (history) return;
    setLoading(true);
    setError(null);
    try {
      setHistory(await bffFetch<PackageUnitExpiryDTO[]>(`members/packages/${memberPackageId}/unit-expiries`, { studioId }));
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2 ui-caption" style={{ color: 'inherit' }} data-testid="usage-period-status">
      {lines.map((line) => (
        <div key={line.unit} className="grid gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span>{line.text}</span>
            <Badge variant={line.burns ? 'solid' : 'outline'} tone="inverse">
              {line.badge}
            </Badge>
          </div>
          {line.hint && <span style={{ opacity: 0.85 }}>{line.hint}</span>}
        </div>
      ))}
      {expiredUnits > 0 && (
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span>{t('usagePeriods.expired.total', { units: usageQuotaNoun(t, entitlementKind, expiredUnits) })}</span>
            <Button size="sm" variant="link" tone="inverse" onClick={() => void toggleHistory()} aria-expanded={open}>
              {t(open ? 'usagePeriods.history.hide' : 'usagePeriods.history.show')}
            </Button>
          </div>
          {open && loading && <span style={{ opacity: 0.85 }}>{t('common.loading')}</span>}
          {open && error && <span>{error}</span>}
          {open && history && history.length === 0 && <span style={{ opacity: 0.85 }}>{t('usagePeriods.history.empty')}</span>}
          {open && history && history.length > 0 && (
            <ul className="grid gap-0.5">
              {history.map((row) => (
                <li key={row.id} style={{ opacity: 0.85 }}>
                  {describeUnitExpiry(t, row, { locale, now, entitlementKind, timeZone: usagePeriods[0].timeZone })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
