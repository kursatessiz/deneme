'use client';

import { useEffect, useState } from 'react';
import type { RetailSettingsDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { retailErrorMessage } from '@/lib/retail/errors';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { fieldStyle, labelStyle, sectionStyle } from './styles';

/** Backorder switch and receipt prefix; tax comes from the studio's region settings and is only shown here. */
export function SettingsTab() {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const { data, loading, error } = useBff<RetailSettingsDTO>(`studios/${activeStudioId}/retail/settings`, activeStudioId);
  const [allowBackorder, setAllowBackorder] = useState(false);
  const [receiptPrefix, setReceiptPrefix] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAllowBackorder(data.allowBackorder);
    setReceiptPrefix(data.receiptPrefix);
  }, [data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await bffFetch(`studios/${activeStudioId}/retail/settings`, {
        method: 'PUT',
        studioId: activeStudioId,
        body: { allowBackorder, receiptPrefix: receiptPrefix.trim().toUpperCase() },
      });
      setMessage(t('retail.saved'));
    } catch (err) {
      setMessage(retailErrorMessage(t, err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? undefined} />;

  return (
    <form onSubmit={save} className="p-4 space-y-4 max-w-xl" style={sectionStyle}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('retail.settings.title')}
      </h3>
      <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
        <input type="checkbox" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} className="mt-1" />
        <span>
          {t('retail.settings.allowBackorder')}
          <span className="block text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('retail.settings.allowBackorderHint')}
          </span>
        </span>
      </label>
      <label className="block text-xs space-y-1" style={labelStyle}>
        <span>{t('retail.settings.receiptPrefix')}</span>
        <input value={receiptPrefix} maxLength={10} onChange={(e) => setReceiptPrefix(e.target.value)} className="text-sm px-3 py-1.5 w-40" style={fieldStyle} />
        <span className="block text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('retail.settings.receiptPrefixHint')}
        </span>
      </label>
      <p className="text-xs" style={labelStyle}>
        {t('retail.settings.tax', {
          regime: data.taxRegime,
          rate: data.defaultTaxRate,
          pricing: data.pricesIncludeTax ? t('retail.settings.pricesInclusive') : t('retail.settings.pricesExclusive'),
        })}
      </p>
      {message && (
        <p className="text-xs" role="status" style={labelStyle}>
          {message}
        </p>
      )}
      <PermissionButton required={['retail.manage']} type="submit" variant="primary" disabled={saving}>
        {t('retail.settings.save')}
      </PermissionButton>
    </form>
  );
}
