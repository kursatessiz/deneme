import Link from 'next/link';
import { leadFormConsentVersion, resolveBlockText } from '@platform/shared';
import type { BlockDTO, PublicPageContext, Translate } from '@platform/shared';
import { formatMoney } from '@/lib/money';
import { Accordion, AccordionItem, Badge, Card, CardContent, LinkButton } from '@/components/ui';
import { LeadFormBlock } from './LeadFormBlock';

/*
 * Layout only: the page engine renders on the component library and the
 * kit tokens (docs/TASARIM.md). Colors, borders, radii and type come from
 * the pui-* and ui-* classes; Tailwind utilities below are flex, grid, gap,
 * spacing and width.
 */
const SECTION = 'max-w-6xl mx-auto px-6 py-16 grid gap-6';
const SECTION_NARROW = 'max-w-3xl mx-auto px-6 py-16 grid gap-6';
const SECTION_CENTER = `${SECTION} justify-items-center text-center`;
const CARD_GRID = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]';

function slugifySectorKey(key: string): string {
  return key.replace(/_/g, '-');
}

/**
 * The contact/lead_form sections' anchor id, matched to the convention CTA
 * blocks are authored with per locale (`#iletisim` in Turkish content,
 * `#contact` otherwise -- see the seed data and the sector landing wizard).
 * If a page has both a `contact` and a `lead_form` block, both intentionally
 * share this id so either CTA link lands on whichever comes first.
 */
function contactAnchorId(locale: string): string {
  return locale.startsWith('tr') ? 'iletisim' : 'contact';
}

/**
 * Renders one page's blocks in order, server side. Only the lead_form block
 * mounts client JS (docs/SAYFA_MOTORU.md: "no client-side JS beyond
 * consent/tracking/forms/AB"). A/B: blocks without `abVariantKey` always
 * render; others render only for the visitor's assigned variant.
 */
export function BlockRenderer({
  blocks,
  locale,
  defaultLocale,
  studioSlug,
  context,
  variant,
  t,
}: {
  blocks: readonly BlockDTO[];
  locale: string;
  defaultLocale: string;
  studioSlug: string;
  context: PublicPageContext;
  variant: string;
  t: Translate;
}) {
  const visible = blocks.filter((b) => !b.abVariantKey || b.abVariantKey === variant);
  return (
    <>
      {visible.map((block) => (
        <div key={block.id}>{renderBlock(block, { locale, defaultLocale, studioSlug, context, t })}</div>
      ))}
    </>
  );
}

interface RenderCtx {
  locale: string;
  defaultLocale: string;
  studioSlug: string;
  context: PublicPageContext;
  t: Translate;
}

function text<T>(data: unknown, ctx: RenderCtx): T | null {
  const map = (data as { text?: Record<string, T> })?.text;
  return resolveBlockText(map, ctx.locale, ctx.defaultLocale);
}

function renderBlock(block: BlockDTO, ctx: RenderCtx): React.ReactNode {
  switch (block.type) {
    case 'hero': {
      const t = text<{ eyebrow?: string; title: string; subtitle?: string; primaryCtaLabel?: string; primaryCtaHref?: string; secondaryCtaLabel?: string; secondaryCtaHref?: string }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={`${SECTION_CENTER} pt-20 pb-16`}>
          {t.eyebrow && (
            <Badge tone="theme" className="ui-eyebrow">
              {t.eyebrow}
            </Badge>
          )}
          <h1 className="ui-display">{t.title}</h1>
          {t.subtitle && <p className="ui-lead ui-text-muted">{t.subtitle}</p>}
          {(t.primaryCtaLabel || t.secondaryCtaLabel) && (
            <div className="flex flex-wrap justify-center gap-3">
              {t.primaryCtaLabel && t.primaryCtaHref && <LinkButton href={t.primaryCtaHref}>{t.primaryCtaLabel}</LinkButton>}
              {t.secondaryCtaLabel && t.secondaryCtaHref && (
                <LinkButton href={t.secondaryCtaHref} variant="outline" tone="surface">
                  {t.secondaryCtaLabel}
                </LinkButton>
              )}
            </div>
          )}
        </section>
      );
    }

    case 'feature_grid': {
      const t = text<{ title?: string; items: { title: string; description: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION}>
          {t.title && <h2 className="ui-title">{t.title}</h2>}
          <div className={CARD_GRID}>
            {t.items.map((item, i) => (
              <Card key={i}>
                <CardContent>
                  <h3 className="ui-heading">{item.title}</h3>
                  <p className="ui-text-muted">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      );
    }

    case 'sector_cards': {
      const t = text<{ title?: string; description?: string }>(block.data, ctx);
      const businessTypes = ctx.context.businessTypes ?? [];
      return (
        <section className={SECTION}>
          {t?.title && <h2 className="ui-title">{t.title}</h2>}
          {t?.description && <p className="ui-text-muted">{t.description}</p>}
          <div className={CARD_GRID}>
            {businessTypes.map((bt) => (
              <Link key={bt.key} href={`/${ctx.locale}/${slugifySectorKey(bt.key)}`} className="pui-card ui-card-link">
                <span className="pui-card-content">
                  <span className="ui-heading">{bt.name}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      );
    }

    case 'how_it_works': {
      const t = text<{ title?: string; steps: { title: string; description: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION}>
          {t.title && <h2 className="ui-title">{t.title}</h2>}
          <ol className={CARD_GRID}>
            {t.steps.map((s, i) => (
              <li key={i} className="pui-card">
                <div className="pui-card-content">
                  <Badge tone="theme" className="justify-self-start">
                    {i + 1}
                  </Badge>
                  <h3 className="ui-heading">{s.title}</h3>
                  <p className="ui-text-muted">{s.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      );
    }

    case 'pricing': {
      const cfg = (block.data as { config?: { hidden?: boolean } })?.config;
      if (cfg?.hidden) return null;
      const t = text<{ title?: string; description?: string }>(block.data, ctx);
      const plans = ctx.context.plans ?? [];
      const packages = ctx.context.packages ?? [];
      return (
        <section className={SECTION}>
          {t?.title && <h2 className="ui-title">{t.title}</h2>}
          {t?.description && <p className="ui-text-muted">{t.description}</p>}
          <div className={CARD_GRID}>
            {plans.map((p) => (
              <Card key={p.key}>
                <CardContent>
                  <h3 className="ui-heading">{p.name}</h3>
                  <p className="ui-stat-value">{formatMoney(p.priceMonthly, p.currency, ctx.locale)}</p>
                </CardContent>
              </Card>
            ))}
            {packages.map((p) => (
              <div key={p.id} className="pui-card ui-gradient-package-card">
                <div className="pui-card-content">
                  <h3 className="ui-heading">{p.name}</h3>
                  <p className="ui-stat-value">{formatMoney(p.price, p.currency, ctx.locale)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'testimonials': {
      const t = text<{ title?: string; items: { quote: string; authorName: string; authorRole?: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION}>
          {t.title && <h2 className="ui-title">{t.title}</h2>}
          <div className={CARD_GRID}>
            {t.items.map((it, i) => (
              <Card as="article" key={i}>
                <blockquote className="pui-card-content">
                  <p className="ui-rail">&ldquo;{it.quote}&rdquo;</p>
                  <footer className="ui-caption">
                    <span className="ui-strong">{it.authorName}</span>
                    {it.authorRole && <span> &middot; {it.authorRole}</span>}
                  </footer>
                </blockquote>
              </Card>
            ))}
          </div>
        </section>
      );
    }

    case 'faq': {
      const t = text<{ title?: string; items: { question: string; answer: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION_NARROW}>
          {t.title && <h2 className="ui-title">{t.title}</h2>}
          <Accordion>
            {t.items.map((item, i) => (
              <AccordionItem key={i} title={item.question}>
                <p className="ui-text-muted">{item.answer}</p>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      );
    }

    case 'stats': {
      const t = text<{ items: { label: string; value: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION}>
          <div className={`${CARD_GRID} text-center`}>
            {t.items.map((s, i) => (
              <div key={i} className="grid gap-1">
                <p className="ui-title">{s.value}</p>
                <p className="ui-caption">{s.label}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'cta': {
      const t = text<{ title: string; description?: string; buttonLabel: string; buttonHref: string }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className="ui-rule">
          <div className={SECTION_CENTER}>
            <h2 className="ui-title">{t.title}</h2>
            {t.description && <p className="ui-text-muted">{t.description}</p>}
            <LinkButton href={t.buttonHref}>{t.buttonLabel}</LinkButton>
          </div>
        </section>
      );
    }

    case 'lead_form': {
      const t = text<{ title?: string; submitLabel?: string; consentText?: string; marketingConsentText?: string }>(block.data, ctx);
      const cfg = (block.data as { config?: { fields?: string[]; marketingConsent?: boolean } })?.config;
      const marketingText = cfg?.marketingConsent ? t?.marketingConsentText || ctx.t('sites.leadForm.marketingConsent') : null;
      return (
        <section className="ui-rule" id={contactAnchorId(ctx.locale)}>
          <div className={SECTION}>
            <LeadFormBlock
              studioSlug={ctx.studioSlug}
              fields={(cfg?.fields as ('fullName' | 'phone' | 'email' | 'interest')[]) ?? ['fullName', 'phone']}
              title={t?.title}
              submitLabel={t?.submitLabel}
              consentText={t?.consentText}
              marketingConsent={marketingText ? { text: marketingText, formVersion: leadFormConsentVersion(ctx.locale, marketingText) } : undefined}
              locale={ctx.locale}
              i18n={{
                fullName: ctx.t('sites.leadForm.fullName'),
                phone: ctx.t('sites.leadForm.phone'),
                email: ctx.t('sites.leadForm.email'),
                message: ctx.t('sites.leadForm.message'),
                defaultConsent: ctx.t('sites.leadForm.defaultConsent'),
                submit: ctx.t('sites.leadForm.submit'),
                sent: ctx.t('sites.leadForm.sent'),
                error: ctx.t('sites.leadForm.error'),
              }}
            />
          </div>
        </section>
      );
    }

    case 'booking_widget': {
      const t = text<{ title?: string; buttonLabel?: string }>(block.data, ctx);
      return (
        <section className={SECTION_CENTER}>
          {t?.title && <h2 className="ui-title">{t.title}</h2>}
          <LinkButton href={`/booking/${ctx.studioSlug}/book`}>{t?.buttonLabel || ctx.t('sites.bookingWidget.defaultButton')}</LinkButton>
        </section>
      );
    }

    case 'trainers': {
      const t = text<{ title?: string; items: { name: string; photoUrl?: string; bio?: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section className={SECTION}>
          {t.title && <h2 className="ui-title">{t.title}</h2>}
          <div className={CARD_GRID}>
            {t.items.map((tr, i) => (
              <Card key={i}>
                <CardContent>
                  <h3 className="ui-heading">{tr.name}</h3>
                  {tr.bio && <p className="ui-text-muted">{tr.bio}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      );
    }

    case 'contact': {
      const t = text<{ title?: string; description?: string }>(block.data, ctx);
      const cfg = (block.data as { config?: { showAddress?: boolean; showPhone?: boolean; showEmail?: boolean } })?.config;
      const info = ctx.context.companyInfo ?? ctx.context.studioContact;
      return (
        <section className="ui-rule" id={contactAnchorId(ctx.locale)}>
          <div className={SECTION_CENTER}>
            {t?.title && <h2 className="ui-title">{t.title}</h2>}
            {t?.description && <p className="ui-text-muted">{t.description}</p>}
            {info && (
              <div className="grid gap-1 ui-text-muted">
                {cfg?.showAddress !== false && info.address && <p>{info.address}</p>}
                {cfg?.showPhone !== false && info.phone && <p>{info.phone}</p>}
                {cfg?.showEmail !== false && info.email && <p>{info.email}</p>}
              </div>
            )}
          </div>
        </section>
      );
    }

    case 'legal_text': {
      const t = text<{ title?: string; body: string }>(block.data, ctx);
      if (!t) return null;
      const paragraphs = t.body.split(/\n{2,}/);
      return (
        <section className={SECTION_NARROW}>
          {t.title && <h1 className="ui-title">{t.title}</h1>}
          <div className="grid gap-4">
            {paragraphs.map((p, i) => (
              <p key={i} className="ui-text-muted">
                {p}
              </p>
            ))}
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}
