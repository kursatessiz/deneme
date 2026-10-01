'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Palette } from 'lucide-react';
import type { AppearancePreference, BranchDTO, MembershipDTO } from '@platform/shared';
import { setActiveBranchCookie } from '@/lib/session/active-selection';
import { bffFetch } from '@/lib/session/client';
import { useT, useLocale } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownSection } from '@/components/ui/Dropdown';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';

/** The mode the page shows right now: the saved choice, or the OS mode for "system". */
function useEffectiveDark(colorScheme: AppearancePreference['colorScheme']): boolean {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return colorScheme === 'DARK' || (colorScheme === 'SYSTEM' && systemDark);
}

export function Header({
  userName,
  membership,
  branches,
  activeBranchId,
  appearance,
}: {
  userName: string;
  membership: MembershipDTO;
  branches: BranchDTO[];
  activeBranchId: string | null;
  appearance: AppearancePreference;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const today = new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const [pendingScheme, setPendingScheme] = useState<AppearancePreference['colorScheme'] | null>(null);
  const [appearanceError, setAppearanceError] = useState(false);
  const isDark = useEffectiveDark(pendingScheme ?? appearance.colorScheme);

  function switchBranch(branchId: string) {
    setActiveBranchCookie(branchId);
    router.refresh();
  }

  async function setDark(dark: boolean) {
    const colorScheme = dark ? 'DARK' : 'LIGHT';
    setPendingScheme(colorScheme);
    setAppearanceError(false);
    try {
      // Only the mode changes; the stored (legacy) family is sent back as it is.
      await bffFetch<AppearancePreference>('me/appearance', { method: 'PUT', body: { themeFamily: appearance.themeFamily, colorScheme } });
      router.refresh();
    } catch {
      setAppearanceError(true);
      setPendingScheme(null);
    }
  }

  async function signOut() {
    try {
      await bffFetch('auth/logout', { method: 'POST' });
    } finally {
      router.push('/giris');
      router.refresh();
    }
  }

  return (
    <header
      className="h-16 px-6 flex items-center justify-between gap-4 sticky top-0 z-30"
      style={{ backgroundColor: 'var(--pui-bg)', borderBottom: 'var(--pui-border-width) solid var(--pui-border)' }}
    >
      <span className="ui-text-muted ui-capitalize truncate">{today}</span>

      <div className="flex items-center gap-2">
        {branches.length > 1 && (
          <Select aria-label={t('layout.activeBranch')} value={activeBranchId ?? ''} onChange={(e) => switchBranch(e.target.value)}>
            <option value="">{t('layout.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}

        <LanguageSwitcher mode="me" className="pui-input" />

        <Dropdown
          variant="link"
          tone="surface"
          align="end"
          ariaLabel={t('layout.userMenu')}
          label={
            <span className="flex items-center gap-2">
              <Avatar name={userName} />
              <span className="hidden sm:grid text-left">
                <span className="ui-heading">{userName}</span>
                <span className="ui-caption">{membership.roleName}</span>
              </span>
            </span>
          }
        >
          <div className="grid gap-1" style={{ minWidth: '14rem' }}>
            <DropdownSection>
              <Switch label={t('layout.darkMode')} checked={isDark} onCheckedChange={(v) => void setDark(v)} />
              {appearanceError && (
                <p className="ui-caption ui-text-error mt-1">
                  {t('layout.appearanceSaveFailed')}
                </p>
              )}
            </DropdownSection>
            <Link href="/ayarlar/gorunum" className="pui-btn pui-link pui-surface ui-nav-link">
              <Palette className="ui-icon" aria-hidden="true" />
              {t('layout.appearanceSettings')}
            </Link>
          </div>
        </Dropdown>

        <Button
          variant="link"
          tone="muted"
          iconOnly
          title={t('layout.signOut')}
          aria-label={t('layout.signOut')}
          onClick={signOut}
          icon={<LogOut className="ui-icon" aria-hidden="true" />}
        />
      </div>
    </header>
  );
}
