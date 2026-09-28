'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_TENANT_THEME, resolveTheme, themeCssVariables } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import type { ConsentChoice } from '@/lib/tracking/consent';
import type { ConsentMode } from '@/lib/tracking/region';

/**
 * Region-aware consent banner (docs/CRM_VE_ATIF.md "Çerez izni"). Styled
 * with the default tenant theme tokens so it reads the same on the
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

  const button = (primary: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 'var(--radius-button)',
    border: primary ? 'none' : '1px solid var(--color-border)',
    background: primary ? 'var(--gradient-brand)' : 'var(--color-surface)',
    color: primary ? 'var(--color-on-primary)' : 'var(--color-text-primary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('consent.title')}
      data-testid="consent-banner"
      data-consent-mode={mode}
      style={{
        ...vars,
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 1000,
        maxWidth: 560,
        margin: '0 auto',
        padding: 16,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 6, fontSize: 14 }}>{t('consent.title')}</strong>
      <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{body}</p>
      {mode === 'notice' && gpc ? (
        <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>{t('consent.gpcHonoured')}</p>
      ) : null}

      {customizing ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked disabled />
            <span>
              {t('consent.category.necessary')}
              <span style={{ display: 'block', color: 'var(--color-text-muted)' }}>{t('consent.category.necessaryHint')}</span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              name="analytics"
              checked={analytics}
              onChange={(e) => {
                setAnalytics(e.target.checked);
                if (!e.target.checked) setAdvertising(false);
              }}
            />
            <span>
              {t('consent.category.analytics')}
              <span style={{ display: 'block', color: 'var(--color-text-muted)' }}>{t('consent.category.analyticsHint')}</span>
            </span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              name="advertising"
              checked={advertising}
              disabled={gpc}
              onChange={(e) => {
                setAdvertising(e.target.checked);
                if (e.target.checked) setAnalytics(true);
              }}
            />
            <span>
              {t('consent.category.advertising')}
              <span style={{ display: 'block', color: 'var(--color-text-muted)' }}>{t('consent.category.advertisingHint')}</span>
            </span>
          </label>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {mode === 'notice' ? (
          <>
            <button type="button" style={button(true)} onClick={() => onDecide({ analytics: true, advertising: !gpc })}>
              {t('consent.ok')}
            </button>
            {!gpc ? (
              <button type="button" style={button(false)} onClick={() => onDecide({ analytics: true, advertising: false })}>
                {t('consent.optOutAdvertising')}
              </button>
            ) : null}
          </>
        ) : customizing ? (
          <button type="button" style={button(true)} onClick={() => onDecide({ analytics, advertising })}>
            {t('consent.save')}
          </button>
        ) : (
          <>
            <button type="button" style={button(true)} onClick={() => onDecide({ analytics: true, advertising: true })}>
              {t('consent.acceptAll')}
            </button>
            <button type="button" style={button(false)} onClick={() => onDecide({ analytics: false, advertising: false })}>
              {t('consent.rejectAll')}
            </button>
            <button type="button" style={button(false)} onClick={() => setCustomizing(true)}>
              {t('consent.customize')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
