'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_TENANT_THEME, resolveTheme, themeCssVariables } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Button, Checkbox } from '@/components/ui';
import type { ConsentChoice } from '@/lib/tracking/consent';
import type { ConsentMode } from '@/lib/tracking/region';

/**
 * Region-aware consent banner (docs/CRM_VE_ATIF.md "Çerez izni"). Drawn
 * with the component library and the default tenant theme tokens so it reads the same on the
 * product page, the booking page and inside the embed iframe.
 * All text comes from the `consent.*` message keys.
 */
export function ConsentBanner({
  mode,
  gpc,
  onDecide,
}: {
  mode: ConsentMode;
  gpc: boolean;
  onDecide: (choice: ConsentChoice) => void;
}) {
  const t = useT();
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const vars = useMemo(
    () =>
      themeCssVariables(
        resolveTheme({ tenant: DEFAULT_TENANT_THEME, appearance: { themeFamily: null, colorScheme: 'SYSTEM' }, systemMode: 'light' }),
      ) as React.CSSProperties,
    [],
  );

  const body = mode === 'opt_in' ? t('consent.optIn.body') : mode === 'kvkk' ? t('consent.kvkk.body') : t('consent.notice.body');

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('consent.title')}
      data-testid="consent-banner"
      data-consent-mode={mode}
      className="pui-card fixed inset-x-4 bottom-4 z-[1000] mx-auto max-w-xl"
      style={vars}
    >
      <div className="pui-card-content">
        <strong className="ui-heading">{t('consent.title')}</strong>
        <p className="ui-text-muted">{body}</p>
        {mode === 'notice' && gpc ? <p className="ui-text-muted">{t('consent.gpcHonoured')}</p> : null}

        {customizing ? (
          <div className="grid gap-2">
            <Checkbox
              checked
              disabled
              label={
                <>
                  {t('consent.category.necessary')}
                  <span className="block ui-caption">{t('consent.category.necessaryHint')}</span>
                </>
              }
            />
            <Checkbox
              name="analytics"
              checked={analytics}
              onChange={(e) => {
                setAnalytics(e.target.checked);
                if (!e.target.checked) setAdvertising(false);
              }}
              label={
                <>
                  {t('consent.category.analytics')}
                  <span className="block ui-caption">{t('consent.category.analyticsHint')}</span>
                </>
              }
            />
            <Checkbox
              name="advertising"
              checked={advertising}
              disabled={gpc}
              onChange={(e) => {
                setAdvertising(e.target.checked);
                if (e.target.checked) setAnalytics(true);
              }}
              label={
                <>
                  {t('consent.category.advertising')}
                  <span className="block ui-caption">{t('consent.category.advertisingHint')}</span>
                </>
              }
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {mode === 'notice' ? (
            <>
              <Button size="sm" onClick={() => onDecide({ analytics: true, advertising: !gpc })}>
                {t('consent.ok')}
              </Button>
              {!gpc ? (
                <Button size="sm" variant="outline" tone="surface" onClick={() => onDecide({ analytics: true, advertising: false })}>
                  {t('consent.optOutAdvertising')}
                </Button>
              ) : null}
            </>
          ) : customizing ? (
            <Button size="sm" onClick={() => onDecide({ analytics, advertising })}>
              {t('consent.save')}
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => onDecide({ analytics: true, advertising: true })}>
                {t('consent.acceptAll')}
              </Button>
              <Button size="sm" variant="outline" tone="surface" onClick={() => onDecide({ analytics: false, advertising: false })}>
                {t('consent.rejectAll')}
              </Button>
              <Button size="sm" variant="outline" tone="surface" onClick={() => setCustomizing(true)}>
                {t('consent.customize')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
