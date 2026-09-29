import Link from 'next/link';
import { leadFormConsentVersion, resolveBlockText } from '@platform/shared';
import type { BlockDTO, PublicPageContext, Translate } from '@platform/shared';
import { formatMoney } from '@/lib/money';
import { LeadFormBlock } from './LeadFormBlock';

const container: React.CSSProperties = { maxWidth: 1040, margin: '0 auto', padding: '48px 24px' };
const heading: React.CSSProperties = { fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 800, letterSpacing: '-0.01em', margin: 0 };
const body: React.CSSProperties = { color: 'var(--color-text-secondary)', lineHeight: 1.6, marginTop: 10 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 24 };
const card: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: 20, backgroundColor: 'var(--color-surface)' };
const primaryLink: React.CSSProperties = {
  display: 'inline-block',
  padding: '13px 26px',
  borderRadius: 'var(--radius-button)',
  fontWeight: 700,
  color: '#fff',
  textDecoration: 'none',
  backgroundImage: 'var(--gradient-brand)',
};

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
        <section style={{ ...container, textAlign: 'center', paddingTop: 72 }}>
          {t.eyebrow && <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>{t.eyebrow}</p>}
          <h1 style={heading}>{t.title}</h1>
          {t.subtitle && <p style={{ ...body, fontSize: 17, maxWidth: 640, margin: '14px auto 0' }}>{t.subtitle}</p>}
          {(t.primaryCtaLabel || t.secondaryCtaLabel) && (
            <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {t.primaryCtaLabel && t.primaryCtaHref && (
                <Link href={t.primaryCtaHref} style={primaryLink}>
                  {t.primaryCtaLabel}
                </Link>
              )}
              {t.secondaryCtaLabel && t.secondaryCtaHref && (
                <Link
                  href={t.secondaryCtaHref}
                  style={{ display: 'inline-block', padding: '13px 26px', borderRadius: 'var(--radius-button)', fontWeight: 600, color: 'var(--color-text-primary)', textDecoration: 'none', border: '1px solid var(--color-border)' }}
                >
                  {t.secondaryCtaLabel}
                </Link>
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
        <section style={container}>
          {t.title && <h2 style={heading}>{t.title}</h2>}
          <div style={grid}>
            {t.items.map((item, i) => (
              <div key={i} style={card}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{item.title}</h3>
                <p style={body}>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'sector_cards': {
      const t = text<{ title?: string; description?: string }>(block.data, ctx);
      const businessTypes = ctx.context.businessTypes ?? [];
      return (
        <section style={container}>
          {t?.title && <h2 style={heading}>{t.title}</h2>}
          {t?.description && <p style={body}>{t.description}</p>}
          <div style={grid}>
            {businessTypes.map((bt) => (
              <Link key={bt.key} href={`/${ctx.locale}/${slugifySectorKey(bt.key)}`} style={{ ...card, textDecoration: 'none', color: 'var(--color-text-primary)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{bt.name}</h3>
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
        <section style={container}>
          {t.title && <h2 style={heading}>{t.title}</h2>}
          <ol style={{ ...grid, listStyle: 'none', padding: 0 }}>
            {t.steps.map((s, i) => (
              <li key={i} style={card}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>{i + 1}</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0' }}>{s.title}</h3>
                <p style={body}>{s.description}</p>
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
        <section style={container}>
          {t?.title && <h2 style={heading}>{t.title}</h2>}
          {t?.description && <p style={body}>{t.description}</p>}
          <div style={grid}>
            {plans.map((p) => (
              <div key={p.key} style={card}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{p.name}</h3>
                <p style={{ ...body, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)' }}>{formatMoney(p.priceMonthly, p.currency, ctx.locale)}</p>
              </div>
            ))}
            {packages.map((p) => (
              <div key={p.id} style={card}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{p.name}</h3>
                <p style={{ ...body, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)' }}>{formatMoney(p.price, p.currency, ctx.locale)}</p>
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
        <section style={container}>
          {t.title && <h2 style={heading}>{t.title}</h2>}
          <div style={grid}>
            {t.items.map((it, i) => (
              <blockquote key={i} style={{ ...card, margin: 0 }}>
                <p style={body}>&ldquo;{it.quote}&rdquo;</p>
                <footer style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>
                  {it.authorName}
                  {it.authorRole && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> · {it.authorRole}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      );
    }

    case 'faq': {
      const t = text<{ title?: string; items: { question: string; answer: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section style={container}>
          {t.title && <h2 style={heading}>{t.title}</h2>}
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {t.items.map((item, i) => (
              <details key={i} style={{ ...card, padding: 16 }}>
                <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{item.question}</summary>
                <p style={body}>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      );
    }

    case 'stats': {
      const t = text<{ items: { label: string; value: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section style={container}>
          <div style={grid}>
            {t.items.map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 30, fontWeight: 800, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{s.label}</p>
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
        <section style={{ ...container, textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
          <h2 style={heading}>{t.title}</h2>
          {t.description && <p style={body}>{t.description}</p>}
          <Link href={t.buttonHref} style={{ ...primaryLink, marginTop: 20 }}>
            {t.buttonLabel}
          </Link>
        </section>
      );
    }

    case 'lead_form': {
      const t = text<{ title?: string; submitLabel?: string; consentText?: string; marketingConsentText?: string }>(block.data, ctx);
      const cfg = (block.data as { config?: { fields?: string[]; marketingConsent?: boolean } })?.config;
      const marketingText = cfg?.marketingConsent ? t?.marketingConsentText || ctx.t('sites.leadForm.marketingConsent') : null;
      return (
        <section style={{ ...container, borderTop: '1px solid var(--color-border)' }} id={contactAnchorId(ctx.locale)}>
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
        </section>
      );
    }

    case 'booking_widget': {
      const t = text<{ title?: string; buttonLabel?: string }>(block.data, ctx);
      return (
        <section style={{ ...container, textAlign: 'center' }}>
          {t?.title && <h2 style={heading}>{t.title}</h2>}
          <Link href={`/booking/${ctx.studioSlug}/book`} style={{ ...primaryLink, marginTop: 20 }}>
            {t?.buttonLabel || ctx.t('sites.bookingWidget.defaultButton')}
          </Link>
        </section>
      );
    }

    case 'trainers': {
      const t = text<{ title?: string; items: { name: string; photoUrl?: string; bio?: string }[] }>(block.data, ctx);
      if (!t) return null;
      return (
        <section style={container}>
          {t.title && <h2 style={heading}>{t.title}</h2>}
          <div style={grid}>
            {t.items.map((tr, i) => (
              <div key={i} style={card}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{tr.name}</h3>
                {tr.bio && <p style={body}>{tr.bio}</p>}
              </div>
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
        <section style={{ ...container, textAlign: 'center', borderTop: '1px solid var(--color-border)' }} id={contactAnchorId(ctx.locale)}>
          {t?.title && <h2 style={heading}>{t.title}</h2>}
          {t?.description && <p style={body}>{t.description}</p>}
          {info && (
            <div style={{ marginTop: 16, fontSize: 14, color: 'var(--color-text-secondary)' }}>
              {cfg?.showAddress !== false && info.address && <p>{info.address}</p>}
              {cfg?.showPhone !== false && info.phone && <p>{info.phone}</p>}
              {cfg?.showEmail !== false && info.email && <p>{info.email}</p>}
            </div>
          )}
        </section>
      );
    }

    case 'legal_text': {
      const t = text<{ title?: string; body: string }>(block.data, ctx);
      if (!t) return null;
      const paragraphs = t.body.split(/\n{2,}/);
      return (
        <section style={{ ...container, maxWidth: 760 }}>
          {t.title && <h1 style={heading}>{t.title}</h1>}
          <div style={{ marginTop: 20 }}>
            {paragraphs.map((p, i) => (
              <p key={i} style={body}>
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
