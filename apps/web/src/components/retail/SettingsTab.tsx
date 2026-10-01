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
import { Card, Checkbox, FieldGroup, Input } from '@/components/ui';

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
    <Card className="max-w-xl">
      <form onSubmit={save} className="pui-card-content">
        <h3 className="ui-heading">{t('retail.settings.title')}</h3>
        <Checkbox
          checked={allowBackorder}
          onChange={(e) => setAllowBackorder(e.target.checked)}
          label={
            <>
              {t('retail.settings.allowBackorder')}
              <span className="block ui-caption">{t('retail.settings.allowBackorderHint')}</span>
            </>
          }
        />
        <FieldGroup label={t('retail.settings.receiptPrefix')} hint={t('retail.settings.receiptPrefixHint')}>
          <Input value={receiptPrefix} maxLength={10} onChange={(e) => setReceiptPrefix(e.target.value)} className="w-40" />
        </FieldGroup>
        <p className="ui-caption">
          {t('retail.settings.tax', {
            regime: data.taxRegime,
            rate: data.defaultTaxRate,
            pricing: data.pricesIncludeTax ? t('retail.settings.pricesInclusive') : t('retail.settings.pricesExclusive'),
          })}
        </p>
        {message && (
          <p className="ui-caption" role="status">
            {message}
          </p>
        )}
        <div>
          <PermissionButton required={['retail.manage']} type="submit" variant="primary" disabled={saving}>
            {t('retail.settings.save')}
          </PermissionButton>
        </div>
      </form>
    </Card>
  );
}
