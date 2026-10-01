'use client';

import { useState } from 'react';
import { OPTIONAL_THEME_FAMILY_KEYS, THEME_FAMILY_KEYS } from '@platform/shared';
import type { OptionalThemeFamilyKey, TenantThemeFamiliesDTO, ThemeFamilyKey } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Radio } from '@/components/ui/Radio';

/**
 * Super-admin "Tema aileleri" section of the tenants table: which design
 * families the studio may use (Perfect UI is always allowed) and the family
 * it currently uses. Saved through PUT admin/tenants/:id/theme-families.
 */
export function TenantThemeFamilies({ studioId }: { studioId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState<OptionalThemeFamilyKey[]>([]);
  const [current, setCurrent] = useState<ThemeFamilyKey>('perfect');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const dto = await bffFetch<TenantThemeFamiliesDTO>(`admin/tenants/${studioId}/theme-families`);
      setAllowed(OPTIONAL_THEME_FAMILY_KEYS.filter((key) => dto.allowed.includes(key)));
      setCurrent(dto.current);
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('themeDesign.admin.loadFailed'), error: true });
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    if (!open) void load();
    setOpen(!open);
  };

  const toggleAllowed = (key: OptionalThemeFamilyKey) => {
    const next = allowed.includes(key) ? allowed.filter((k) => k !== key) : [...allowed, key];
    setAllowed(next);
    // The current family cannot stay on a family that was just switched off.
    if (current === key && !next.includes(key)) setCurrent('perfect');
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const dto = await bffFetch<TenantThemeFamiliesDTO>(`admin/tenants/${studioId}/theme-families`, {
        method: 'PUT',
        body: { allowed, current },
      });
      setAllowed(OPTIONAL_THEME_FAMILY_KEYS.filter((key) => dto.allowed.includes(key)));
      setCurrent(dto.current);
      setMessage({ text: t('themeDesign.admin.saved'), error: false });
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('themeDesign.admin.saveFailed'), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Button variant="link" tone="surface" size="sm" onClick={toggleOpen}>
        {open ? t('themeDesign.admin.close') : t('themeDesign.admin.open')}
      </Button>
      {open && (
        <div className="ui-panel grid gap-3" style={{ minWidth: '16rem' }}>
          <p className="ui-caption ui-text-muted">{t('themeDesign.admin.description')}</p>
          {loading ? null : (
            <>
              <fieldset className="grid gap-2">
                <legend className="ui-caption mb-1">{t('themeDesign.admin.allowedLabel')}</legend>
                {OPTIONAL_THEME_FAMILY_KEYS.map((key) => (
                  <Checkbox key={key} checked={allowed.includes(key)} onChange={() => toggleAllowed(key)} label={t(`themeDesign.family.${key}.name`)} />
                ))}
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="ui-caption mb-1">{t('themeDesign.admin.currentLabel')}</legend>
                {THEME_FAMILY_KEYS.filter((key) => key === 'perfect' || allowed.includes(key as OptionalThemeFamilyKey)).map((key) => (
                  <Radio
                    key={key}
                    name={`theme-family-${studioId}`}
                    value={key}
                    checked={current === key}
                    onChange={() => setCurrent(key)}
                    label={t(`themeDesign.family.${key}.name`)}
                  />
                ))}
              </fieldset>
              {message && <p className={message.error ? 'ui-caption ui-text-error' : 'ui-caption ui-text-success'}>{message.text}</p>}
              <Button size="sm" onClick={save} loading={busy} className="justify-self-start">
                {busy ? t('themeDesign.admin.saving') : t('themeDesign.admin.save')}
              </Button>
            </>
          )}
          {loading && message && <p className="ui-caption ui-text-error">{message.text}</p>}
        </div>
      )}
    </div>
  );
}
