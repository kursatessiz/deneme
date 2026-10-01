import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@platform/shared';
import type { PublicEventDTO } from '@platform/shared';
import { PublicEventsShell } from '@/components/events/PublicEventsShell';
import { Badge } from '@/components/ui';
import { getT } from '@/lib/i18n/getT';
import { eventsHost, fetchPublicEvents, fetchPublicStudio } from '@/lib/events/api';
import { formatSpan } from '@/lib/events/format';
import { eventDetailPath, eventsListPath } from '@/lib/events/paths';
import { formatMoney } from '@/lib/money';
import { toOgLocale } from '@/lib/seo/og-locale';
import { breadcrumbJsonLd } from '@/lib/sites/jsonld';
import { serializeJsonLd } from '@/lib/sites/json-ld';
import { createZonedFormatters } from '@/lib/zoned-time';

/**
 * Public events of a studio (docs/ETKINLIKLER.md): only PUBLIC and PUBLISHED events that are not over, as the
 * API returns them. Reachable at `/events/<studioSlug>` on the platform host and at `/events` on the studio's
 * own site host (middleware rewrite); the canonical URL is the latter.
 */

type Params = Promise<{ studioSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { studioSlug } = await params;
  const { t, locale } = await getT();
  const config = await fetchPublicStudio(studioSlug);
  if (!config) return { title: t('events.public.title'), robots: { index: false, follow: false } };

  const host = await eventsHost(studioSlug);
  const title = t('events.public.meta.listTitle', { studio: config.name });
  const description = t('events.public.meta.listDescription', { studio: config.name });
  const url = `${host.origin}${host.canonicalListPath}`;
  const images = config.logoUrl ? [{ url: config.logoUrl, alt: config.name }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: config.name || PRODUCT_NAME, locale: toOgLocale(locale), title, description, url, ...(images ? { images } : {}) },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, ...(images ? { images: [images[0].url] } : {}) },
  };
}

function cheapestTicket(event: PublicEventDTO) {
  const open = event.ticketTypes.filter((ticket) => ticket.onSale);
  const pool = open.length > 0 ? open : event.ticketTypes;
  // Selection only (never arithmetic on money): the lowest listed price.
  return pool.reduce<PublicEventDTO['ticketTypes'][number] | null>((best, ticket) => (best === null || Number(ticket.priceAmount) < Number(best.priceAmount) ? ticket : best), null);
}

export default async function PublicEventsPage({ params }: { params: Params }) {
  const { studioSlug } = await params;
  const [config, events, { t, locale }, host] = await Promise.all([fetchPublicStudio(studioSlug), fetchPublicEvents(studioSlug), getT(), eventsHost(studioSlug)]);
  if (!config) notFound();

  const listHref = eventsListPath(studioSlug, host.onTenantHost);
  const breadcrumb = breadcrumbJsonLd([
    { name: config.name, url: host.origin },
    { name: t('events.public.title'), url: `${host.origin}${host.canonicalListPath}` },
  ]);

  return (
    <PublicEventsShell config={config} listHref={listHref}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <div className="grid gap-2">
        <h1 className="ui-title">{t('events.public.heading', { studio: config.name })}</h1>
        <p className="ui-text-muted">{t('events.public.subtitle')}</p>
      </div>

      {events.length === 0 ? (
        <div className="ui-panel p-4 grid gap-1">
          <p className="ui-strong">{t('events.public.empty')}</p>
          <p className="ui-caption ui-text-muted">{t('events.public.emptyHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-4" data-testid="public-events-list">
          {events.map((event) => {
            const zone = createZonedFormatters(locale, event.timezone);
            const ticket = cheapestTicket(event);
            const soldOut = event.remainingSeats <= 0 && !event.waitlistEnabled;
            return (
              <li key={event.id}>
                <Link href={eventDetailPath(studioSlug, host.onTenantHost, event)} className="pui-card ui-card-link" data-testid="public-event-card">
                  <span className="pui-card-content">
                    {event.coverImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={event.coverImageUrl} alt={t('events.public.cover', { event: event.title })} width={1200} height={630} decoding="async" loading="lazy" className="w-full h-auto object-cover" />
                    )}
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="ui-heading">{event.title}</span>
                      {soldOut ? (
                        <Badge tone="warn">{t('events.public.status.soldOut')}</Badge>
                      ) : event.registrationOpen ? (
                        <Badge tone="success">{t('events.public.status.open')}</Badge>
                      ) : (
                        <Badge>{t('events.public.status.closed')}</Badge>
                      )}
                    </span>
                    {event.startsAt && (
                      <span className="ui-text-muted">
                        {formatSpan(zone, event.startsAt, event.endsAt)} {zone.zoneName(event.startsAt)}
                      </span>
                    )}
                    <span className="ui-caption ui-text-muted">{event.location.name}</span>
                    {ticket && (
                      <span className="ui-strong">
                        {Number(ticket.priceAmount) === 0 ? t('events.public.free') : t('events.public.fromPrice', { price: formatMoney(ticket.priceAmount, ticket.currency, locale) })}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PublicEventsShell>
  );
}
