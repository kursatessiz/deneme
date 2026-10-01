import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { ThemeRoot } from '@/components/theme/ThemeRoot';
import { PoweredByBadge } from '@/components/branding/PoweredByBadge';
import { PRODUCT_NAME } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';
import type { EmbedConfig } from '@/lib/public-booking';

/**
 * Page frame of the public event pages: the studio's own brand (logo, color, gradient preset through the
 * public config, the same resolution as the booking page) around a centered reading column, with the
 * language switch in the header. Server-rendered; only the theme root and the switch are client components.
 */
export async function PublicEventsShell({ config, listHref, children }: { config: EmbedConfig; listHref: string; children: ReactNode }) {
  const { t } = await getT();
  return (
    <ThemeRoot
      tenantTheme={{ themeFamily: config.themeFamily, themePrimary: config.themePrimary, gradientPresetKey: config.gradientPresetKey, logoUrl: config.logoUrl }}
      appearance={{ colorScheme: 'SYSTEM' }}
    >
      <main className="px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-3xl grid gap-6">
          <header className="flex items-center justify-between gap-3">
            <Link href={listHref} className="flex items-center gap-3">
              {config.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.logoUrl} alt="" height={32} decoding="async" className="h-8 object-contain" />
              )}
              <span className="ui-heading">{config.name}</span>
            </Link>
            <LanguageSwitcher mode="cookie" className="pui-input ui-btn-sm w-auto" />
          </header>
          {children}
          {config.showPoweredBy && <PoweredByBadge href={config.poweredByUrl} label={t('branding.poweredBy', { product: PRODUCT_NAME })} className="text-center" />}
        </div>
      </main>
    </ThemeRoot>
  );
}
