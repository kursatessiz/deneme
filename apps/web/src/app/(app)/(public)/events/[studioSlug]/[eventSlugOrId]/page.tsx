import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRODUCT_NAME } from '@platform/shared';
import { PublicEventsShell } from '@/components/events/PublicEventsShell';
import { Badge, Card, CardContent } from '@/components/ui';
import { getT } from '@/lib/i18n/getT';
import { eventsHost, fetchPublicEvent, fetchPublicStudio } from '@/lib/events/api';
import { formatSpan, summarize } from '@/lib/events/format';
import { eventSegment, eventsListPath, parseEventSegment } from '@/lib/events/paths';
import { formatMoney } from '@/lib/money';
import { toOgLocale } from '@/lib/seo/og-locale';
import { serializeJsonLd } from '@/lib/sites/json-ld';
import { breadcrumbJsonLd, eventJsonLd } from '@/lib/sites/jsonld';
import { createZonedFormatters, zonedIsoString } from '@/lib/zoned-time';

/**
 * One public event (docs/ETKINLIKLER.md): dates on the clock of the event's zone with the zone named once,
 * tickets, and schema.org Event structured data. The `[eventSlugOrId]` segment is `<title slug>-<id>` or the
 * bare id; only the id is looked up, the canonical URL always carries the current title slug.
 */

type Params = Promise<{ studioSlug: string; eventSlugOrId: string }>;

async function load(params: Params) {
  const { studioSlug, eventSlugOrId } = await params;
  const eventId = parseEventSegment(eventSlugOrId);
  if (!eventId) return null;
  const [config, event] = await Promise.all([fetchPublicStudio(studioSlug), fetchPublicEvent(studioSlug, eventId)]);
  if (!config || !event) return null;
  return { studioSlug, config, event };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t, locale } = await getT();
  const loaded = await load(params);
  if (!loaded) return { title: t('events.public.title'), robots: { index: false, follow: false } };
  const { studioSlug, config, event } = loaded;

  const host = await eventsHost(studioSlug);
  const zone = createZonedFormatters(locale, event.timezone);
  const when = event.startsAt ? `${formatSpan(zone, event.startsAt, event.endsAt)} ${zone.zoneName(event.startsAt)}`.trim() : '';
  const title = t('events.public.meta.detailTitle', { event: event.title, studio: config.name });
  const description = summarize(event.description) || t('events.public.meta.detailDescription', { event: event.title, when, studio: config.name });
  const url = `${host.origin}${host.canonicalListPath}/${eventSegment(event)}`;
  const image = event.coverImageUrl ?? config.logoUrl;
  const images = image ? [{ url: image, alt: event.title }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: config.name || PRODUCT_NAME, locale: toOgLocale(locale), title, description, url, ...(images ? { images } : {}) },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, ...(images ? { images: [images[0].url] } : {}) },
  };
}

export default async function PublicEventPage({ params }: { params: Params }) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { studioSlug, config, event } = loaded;
  const [{ t, locale }, host] = await Promise.all([getT(), eventsHost(studioSlug)]);

  const zone = createZonedFormatters(locale, event.timezone);
  const listHref = eventsListPath(studioSlug, host.onTenantHost);
  const canonicalUrl = `${host.origin}${host.canonicalListPath}/${eventSegment(event)}`;
  const multi = event.occurrences.length > 1;
  const soldOut = event.remainingSeats <= 0 && !event.waitlistEnabled;
  const zoneLabel = event.startsAt ? zone.zoneName(event.startsAt) : '';

  const jsonLd: unknown[] = [
    breadcrumbJsonLd([
      { name: config.name, url: host.origin },
      { name: t('events.public.title'), url: `${host.origin}${host.canonicalListPath}` },
      { name: event.title, url: canonicalUrl },
    ]),
  ];
  if (event.startsAt) {
    jsonLd.push(
      eventJsonLd({
        name: event.title,
        url: canonicalUrl,
        description: summarize(event.description, 500) || null,
        imageUrl: event.coverImageUrl ?? config.logoUrl,
        startDate: zonedIsoString(event.startsAt, event.timezone),
        endDate: event.endsAt ? zonedIsoString(event.endsAt, event.timezone) : null,
        location: event.location,
        organizer: { name: config.name, url: host.origin },
        offers: event.ticketTypes.map((ticket) => ({
          name: ticket.name,
          price: ticket.priceAmount,
          currency: ticket.currency,
          url: canonicalUrl,
          available: ticket.onSale && (event.remainingSeats > 0 || event.waitlistEnabled),
        })),
        occurrences: event.occurrences.map((o) => ({ startDate: zonedIsoString(o.startsAt, event.timezone), endDate: zonedIsoString(o.endsAt, event.timezone) })),
      }),
    );
  }

  return (
    <PublicEventsShell config={config} listHref={listHref}>
      {jsonLd.map((doc, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(doc) }} />
      ))}

      <Link href={listHref} className="pui-link pui-surface ui-caption justify-self-start">
        {t('events.public.back')}
      </Link>

      <article className="grid gap-5">
        {event.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverImageUrl} alt={t('events.public.cover', { event: event.title })} width={1200} height={630} decoding="async" className="w-full h-auto object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="ui-title">{event.title}</h1>
          {soldOut ? (
            <Badge tone="warn">{t('events.public.status.soldOut')}</Badge>
          ) : event.registrationOpen ? (
            <Badge tone="success">{t('events.public.status.open')}</Badge>
          ) : (
            <Badge>{t('events.public.status.closed')}</Badge>
          )}
          {event.remainingSeats > 0 && <Badge tone="theme">{t('events.public.seatsLeft', { count: event.remainingSeats })}</Badge>}
          {event.remainingSeats <= 0 && event.waitlistEnabled && <Badge tone="warn">{t('events.public.status.waitlist')}</Badge>}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          {event.startsAt && (
            <div className="grid gap-1">
              <dt className="ui-caption ui-strong">{t('events.public.when')}</dt>
              <dd>
                {multi ? t('events.public.sessionsCount', { count: event.occurrences.length }) : formatSpan(zone, event.startsAt, event.endsAt)}
                {zoneLabel && <span className="ui-caption ui-text-muted block">{t('events.public.timeZone', { zone: zoneLabel })}</span>}
              </dd>
            </div>
          )}
          <div className="grid gap-1">
            <dt className="ui-caption ui-strong">{t('events.public.where')}</dt>
            <dd>
              {event.location.name}
              {event.location.address && <span className="ui-caption ui-text-muted block">{event.location.address}</span>}
            </dd>
          </div>
        </dl>

        {event.description && <p className="ui-text-muted whitespace-pre-line">{event.description}</p>}

        {multi && (
          <section className="grid gap-2" aria-labelledby="event-sessions">
            <h2 id="event-sessions" className="ui-heading">
              {t('events.public.sessions')}
            </h2>
            <ol className="grid gap-1">
              {event.occurrences.map((o) => (
                <li key={o.startsAt}>{formatSpan(zone, o.startsAt, o.endsAt)}</li>
              ))}
            </ol>
          </section>
        )}

        {event.ticketTypes.length > 0 && (
          <section className="grid gap-3" aria-labelledby="event-tickets">
            <h2 id="event-tickets" className="ui-heading">
              {t('events.public.tickets')}
            </h2>
            <ul className="grid gap-3">
              {event.ticketTypes.map((ticket) => (
                <li key={ticket.id}>
                  <Card>
                    <CardContent>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="ui-heading">{ticket.name}</span>
                        <span className="ui-strong">{Number(ticket.priceAmount) === 0 ? t('events.public.free') : formatMoney(ticket.priceAmount, ticket.currency, locale)}</span>
                      </div>
                      {ticket.description && <p className="ui-caption ui-text-muted">{ticket.description}</p>}
                      <Badge tone={ticket.onSale ? 'success' : 'muted'}>{ticket.onSale ? t('events.public.ticket.onSale') : t('events.public.ticket.notOnSale')}</Badge>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="ui-panel p-4 ui-caption">{t('events.public.registerHint')}</p>
      </article>
    </PublicEventsShell>
  );
}
