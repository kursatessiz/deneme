import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  CreditCard,
  IdCard,
  LogIn,
  MessageSquare,
  Package,
} from 'lucide-react';
import type { MessageKey } from '@platform/shared';
import { PRODUCT_NAME, resolveTheme, themeCssVariables } from '@platform/shared';
import { getT } from '@/lib/i18n/getT';
import { PublicTracking } from '@/components/consent/PublicTracking';
import { CookiePreferencesButton } from '@/components/consent/CookiePreferencesButton';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { LinkButton } from '@/components/ui/LinkButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Timeline, TimelineItem } from '@/components/ui/Timeline';

/**
 * Public product landing at `/`. Every text is an i18n key (landing.*);
 * the product name comes from PRODUCT_NAME. The page engine site of the
 * platform tenant keeps living at `/tr`, `/en` (docs/SAYFA_MOTORU.md), and
 * this page mounts the same consent banner and visitor tracking as it.
 */

const FEATURES: ReadonlyArray<{ key: string; icon: React.ComponentType<{ className?: string }>; title: MessageKey; body: MessageKey }> = [
  { key: 'calendar', icon: CalendarDays, title: 'landing.features.calendar.title', body: 'landing.features.calendar.body' },
  { key: 'packages', icon: Package, title: 'landing.features.packages.title', body: 'landing.features.packages.body' },
  { key: 'members', icon: IdCard, title: 'landing.features.members.title', body: 'landing.features.members.body' },
  { key: 'payments', icon: CreditCard, title: 'landing.features.payments.title', body: 'landing.features.payments.body' },
  { key: 'messaging', icon: MessageSquare, title: 'landing.features.messaging.title', body: 'landing.features.messaging.body' },
  { key: 'reports', icon: BarChart3, title: 'landing.features.reports.title', body: 'landing.features.reports.body' },
];

const STEPS: ReadonlyArray<{ title: MessageKey; body: MessageKey }> = [
  { title: 'landing.how.step1.title', body: 'landing.how.step1.body' },
  { title: 'landing.how.step2.title', body: 'landing.how.step2.body' },
  { title: 'landing.how.step3.title', body: 'landing.how.step3.body' },
  { title: 'landing.how.step4.title', body: 'landing.how.step4.body' },
];

const SECTORS: readonly MessageKey[] = [
  'landing.sectors.pilates',
  'landing.sectors.personalTraining',
  'landing.sectors.physio',
  'landing.sectors.yoga',
  'landing.sectors.wellness',
  'landing.sectors.martialArts',
  'landing.sectors.swimming',
  'landing.sectors.courts',
  'landing.sectors.courses',
  'landing.sectors.kids',
  'landing.sectors.coworking',
];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('landing.meta.title', { product: PRODUCT_NAME }), description: t('landing.meta.description') };
}

/** Decorative glimpse of the panel built from the component library; carries no data. */
function PanelGlimpse({ title, rows }: { title: string; rows: number }) {
  return (
    <div className="pui-card" aria-hidden="true">
      <div className="pui-card-header flex items-center justify-between gap-3">
        <span className="ui-heading" style={{ color: 'var(--pui-text)' }}>
          {title}
        </span>
        <span className="pui-badge pui-soft pui-theme">{rows}</span>
      </div>
      <ul className="pui-list">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="pui-list-item flex items-center gap-3">
            <Avatar name={String.fromCharCode(65 + i * 3)} tone={i === 0 ? 'theme' : i === 1 ? 'success' : 'warn'} />
            <span className="grid gap-1 flex-1">
              <Skeleton width={`${70 - i * 12}%`} height="0.625rem" />
              <Skeleton width={`${45 - i * 8}%`} height="0.5rem" />
            </span>
            <span className={`pui-badge pui-soft ${i === 2 ? 'pui-warn' : 'pui-success'}`}>{`${8 - i * 2}/10`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function LandingPage() {
  const { t } = await getT();
  const product = PRODUCT_NAME;
  // Kit defaults (no tenant), following the visitor's OS light/dark setting.
  const vars = themeCssVariables(resolveTheme({ tenant: null, appearance: { colorScheme: 'SYSTEM' }, systemMode: 'light' }));

  return (
    <div style={{ ...(vars as React.CSSProperties), colorScheme: 'light dark', backgroundColor: 'var(--pui-bg)', color: 'var(--pui-text)', minHeight: '100vh' }}>
      <PublicTracking studioSlug="platform" />

      {/* Dark hero, as in the kit's own presentation; the rest of the page follows the visitor's OS mode. */}
      <section data-pui-mode="dark" style={{ colorScheme: 'dark', backgroundColor: 'var(--pui-bg)', color: 'var(--pui-text)' }}>
        <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <Avatar name={product} />
            <span className="ui-heading">{product}</span>
          </Link>
          <nav aria-label={product} className="hidden md:flex items-center gap-1">
            <a href="#ozellikler" className="pui-btn pui-link pui-surface">
              {t('landing.nav.features')}
            </a>
            <a href="#nasil-calisir" className="pui-btn pui-link pui-surface">
              {t('landing.nav.howItWorks')}
            </a>
            <a href="#sektorler" className="pui-btn pui-link pui-surface">
              {t('landing.nav.sectors')}
            </a>
          </nav>
          <LinkButton href="/giris" variant="outline" tone="surface" size="sm" icon={<LogIn className="ui-icon" aria-hidden="true" />}>
            {t('landing.nav.login')}
          </LinkButton>
        </header>

        <div className="max-w-6xl mx-auto px-6 pt-12 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="grid gap-6 justify-items-start">
            <Chip variant="soft" tone="theme">
              {t('landing.hero.kicker')}
            </Chip>
            <h1 className="ui-display">{t('landing.hero.title')}</h1>
            <p className="ui-lead ui-text-muted">
              {t('landing.hero.subtitle')}
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/giris" className="pui-rounded-full" icon={<LogIn className="ui-icon" aria-hidden="true" />}>
                {t('landing.hero.primary')}
              </LinkButton>
              <LinkButton href="#nasil-calisir" variant="outline" tone="surface" className="pui-rounded-full">
                {t('landing.hero.secondary')}
                <ChevronRight className="ui-icon" aria-hidden="true" />
              </LinkButton>
            </div>
          </div>
          <div className="grid gap-4">
            <PanelGlimpse title={t('screens.dashboard.today.title')} rows={3} />
            <div className="grid grid-cols-2 gap-4" aria-hidden="true">
              <div className="pui-card ui-gradient-member-card p-4 grid gap-2">
                <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
                  {t('settings.appearance.preview.memberCard')}
                </span>
                <Skeleton width="60%" height="0.75rem" />
              </div>
              <div className="pui-card ui-gradient-package-card p-4 grid gap-1">
                <span className="ui-caption" style={{ color: 'inherit', opacity: 0.85 }}>
                  {t('settings.appearance.preview.packageCard')}
                </span>
                <span className="ui-stat-value">8/10</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main>
        <section id="ozellikler" className="max-w-6xl mx-auto px-6 py-20 grid gap-10">
          <div className="grid gap-2 max-w-2xl">
            <h2 className="ui-title">{t('landing.features.title')}</h2>
            <p className="ui-text-muted">{t('landing.features.subtitle')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.key} className="pui-card">
                  <div className="pui-card-content">
                    <span className="pui-badge pui-soft pui-theme justify-self-start" style={{ padding: '0.5rem' }}>
                      <Icon className="ui-icon" aria-hidden="true" />
                    </span>
                    <h3 className="ui-heading">{t(feature.title)}</h3>
                    <p className="ui-text-muted">{t(feature.body)}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="nasil-calisir" style={{ backgroundColor: 'var(--pui-bg-muted)' }}>
          <div className="max-w-6xl mx-auto px-6 py-20 grid gap-10">
            <h2 className="ui-title">{t('landing.how.title')}</h2>
            <Timeline horizontal className="hidden lg:flex">
              {STEPS.map((step, index) => (
                <TimelineItem key={step.title} marker={index + 1} title={t(step.title)} description={t(step.body)} variant="solid" />
              ))}
            </Timeline>
            <Timeline className="lg:hidden">
              {STEPS.map((step, index) => (
                <TimelineItem key={step.title} marker={index + 1} title={t(step.title)} description={t(step.body)} variant="solid" />
              ))}
            </Timeline>
          </div>
        </section>

        <section id="sektorler" className="max-w-6xl mx-auto px-6 py-20 grid gap-6">
          <h2 className="ui-title">{t('landing.sectors.title')}</h2>
          <ul className="flex flex-wrap gap-2">
            {SECTORS.map((key) => (
              <li key={key}>
                <Chip>{t(key)}</Chip>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer style={{ borderTop: 'var(--pui-border-width) solid var(--pui-border)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          <p className="ui-caption">{t('landing.footer.tagline', { product })}</p>
          <div className="ui-caption flex items-center gap-4">
            <Link href="/giris" className="pui-link pui-surface">
              {t('landing.footer.login')}
            </Link>
            <CookiePreferencesButton label={t('sites.footer.cookiePreferences')} />
          </div>
        </div>
      </footer>
    </div>
  );
}
