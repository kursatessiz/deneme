'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ErrorGroupDetailDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LinkButton } from '@/components/ui/LinkButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/Textarea';

/** Super admin: one error group with its stack, breadcrumbs, releases, tenants and actions. */
export default function AdminErrorDetailPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<ErrorGroupDetailDTO>(`admin/errors/${id}`, null, refreshKey);
  const [note, setNote] = useState('');
  const [release, setRelease] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  useEffect(() => {
    if (data) setNote(data.note ?? '');
  }, [data]);

  if (forbidden) return <EmptyState title={t('adminErrors.accessDenied')} />;
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  const act = async (path: string, body: unknown, done?: string, fullPath?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await bffFetch(fullPath ?? `admin/errors/${data.id}/${path}`, { method: path === 'note' ? 'PATCH' : 'POST', body });
      setMessage(done ?? null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage(err instanceof BffError ? err.message : t('adminErrors.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const facts: Array<[string, string]> = [
    [t('adminErrors.col.source'), t(`errors.source.${data.source}`)],
    [t('adminErrors.col.status'), t(`errors.status.${data.status}`)],
    [t('adminErrors.detail.count'), new Intl.NumberFormat(locale).format(data.count)],
    [t('adminErrors.detail.studios'), String(data.affectedStudioCount)],
    [t('adminErrors.detail.users'), String(data.affectedUserCount)],
    [t('adminErrors.detail.firstSeen'), dateTime.format(new Date(data.firstSeenAt))],
    [t('adminErrors.detail.lastSeen'), dateTime.format(new Date(data.lastSeenAt))],
    [t('adminErrors.detail.lastRelease'), data.lastRelease ?? '-'],
    [t('adminErrors.detail.resolvedIn'), data.resolvedInRelease ?? '-'],
  ];

  return (
    <div className="grid gap-6">
      <LinkButton href="/admin/hatalar" variant="link" tone="surface" size="sm" className="justify-self-start">
        {t('adminErrors.detail.back')}
      </LinkButton>
      <div className="grid gap-1">
        <h2 className="ui-title break-all">{data.title}</h2>
        {data.critical && <p className="ui-small ui-strong ui-text-error">{t('adminErrors.critical')}</p>}
      </div>

      {data.mergedIntoId && (
        <p>
          {t('adminErrors.detail.mergedInto')}{' '}
          <Link href={`/admin/hatalar/${data.mergedIntoId}`} className="pui-link pui-surface">
            {t('adminErrors.detail.mergedIntoOpen')}
          </Link>
        </p>
      )}

      <Card>
        <dl className="pui-card-content grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="ui-caption">{label}</dt>
              <dd className="ui-strong break-all">{value}</dd>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-3">
            <dt className="ui-caption">{t('adminErrors.detail.topFrame')}</dt>
            <dd className="ui-mono break-all">{data.topFrame ?? '-'}</dd>
          </div>
        </dl>
      </Card>

      <section aria-label={t('adminErrors.detail.resolve')} className="flex flex-wrap items-center gap-3">
        {data.status !== 'RESOLVED' && (
          <>
            <Input
              aria-label={t('adminErrors.detail.resolveRelease')}
              placeholder={t('adminErrors.detail.resolveRelease')}
              value={release}
              onChange={(e) => setRelease(e.target.value)}
              className="w-80"
            />
            <Button disabled={busy} onClick={() => act('resolve', release.trim() ? { release: release.trim() } : {})}>
              {t('adminErrors.detail.resolve')}
            </Button>
          </>
        )}
        {data.status !== 'IGNORED' && (
          <Button variant="outline" tone="surface" disabled={busy} onClick={() => act('ignore', {})}>
            {t('adminErrors.detail.ignore')}
          </Button>
        )}
        {data.status !== 'OPEN' && (
          <Button variant="outline" tone="surface" disabled={busy} onClick={() => act('reopen', {})}>
            {t('adminErrors.detail.reopen')}
          </Button>
        )}
      </section>

      {!data.mergedIntoId && (
        <section aria-label={t('adminErrors.detail.merge')} className="flex flex-wrap items-center gap-3">
          <Input
            aria-label={t('adminErrors.detail.mergeTarget')}
            placeholder={t('adminErrors.detail.mergeTarget')}
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            className="w-96 ui-mono"
          />
          <Button
            variant="outline"
            tone="surface"
            disabled={busy || mergeTarget.trim().length === 0}
            onClick={() => act('merge', { targetId: mergeTarget.trim() }, t('adminErrors.detail.mergeDone'), `admin/errors/groups/${data.id}/merge`)}
          >
            {t('adminErrors.detail.mergeConfirm')}
          </Button>
          {data.aliasCount > 0 && <span className="ui-caption">{t('adminErrors.detail.aliases', { count: data.aliasCount })}</span>}
        </section>
      )}

      <section className="grid gap-2">
        <label htmlFor="error-group-note" className="ui-heading">
          {t('adminErrors.detail.note')}
        </label>
        <Textarea id="error-group-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
        <Button variant="outline" tone="surface" className="justify-self-start" disabled={busy} onClick={() => act('note', { note }, t('adminErrors.detail.noteSaved'))}>
          {t('adminErrors.detail.noteSave')}
        </Button>
        {message && (
          <p role="status" className="ui-caption">
            {message}
          </p>
        )}
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="grid gap-2 content-start">
          <h3 className="ui-heading">{t('adminErrors.detail.releases')}</h3>
          <ul className="grid gap-1">
            {data.releases.map((r) => (
              <li key={r.release} className="ui-mono">
                {t('adminErrors.detail.releaseCount', { release: r.release, count: r.count })}
              </li>
            ))}
          </ul>
        </section>
        <section className="grid gap-2 content-start">
          <h3 className="ui-heading">{t('adminErrors.detail.affectedStudios')}</h3>
          <ul className="grid gap-1">
            {data.studios.map((s) => (
              <li key={s.studioId}>
                {s.studioName ?? s.studioId} ({s.count})
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="grid gap-2">
        <h3 className="ui-heading">{t('adminErrors.detail.alerts')}</h3>
        {data.alerts.length === 0 ? (
          <p>{t('adminErrors.detail.noAlerts')}</p>
        ) : (
          <ul className="ui-small grid gap-1">
            {data.alerts.map((a) => (
              <li key={a.id}>
                {t(`adminErrors.alert.kind.${a.kind}`)} - {dateTime.format(new Date(a.createdAt))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="ui-heading">{t('adminErrors.detail.events')}</h3>
        {data.events.length === 0 && <p>{t('adminErrors.detail.noEvents')}</p>}
        <Accordion>
          {data.events.map((e) => (
            <AccordionItem
              key={e.id}
              title={
                <>
                  <span className="ui-mono">{e.code}</span> - {dateTime.format(new Date(e.occurredAt))} - {e.studioName ?? t('adminErrors.detail.platform')}
                </>
              }
            >
              <div className="grid gap-3">
                <dl className="grid grid-cols-2 gap-2 ui-small">
                  <dt className="ui-caption">{t('adminErrors.detail.requestId')}</dt>
                  <dd className="ui-mono break-all">{e.requestId ?? '-'}</dd>
                  <dt className="ui-caption">{t('adminErrors.detail.route')}</dt>
                  <dd className="ui-mono break-all">{e.route ?? '-'}</dd>
                  <dt className="ui-caption">{t('adminErrors.detail.release')}</dt>
                  <dd className="ui-mono">{e.release}</dd>
                  <dt className="ui-caption">{t('adminErrors.detail.status')}</dt>
                  <dd>{e.statusCode ?? '-'}</dd>
                </dl>
                <p className="break-all">{e.message}</p>
                {e.feedback && (
                  <div className="grid gap-1">
                    <h4 className="ui-small ui-strong">{t('adminErrors.detail.feedback')}</h4>
                    <p className="whitespace-pre-wrap break-words" data-testid="error-feedback">
                      {e.feedback}
                    </p>
                  </div>
                )}
                <div className="grid gap-1">
                  <h4 className="ui-small ui-strong">{e.symbolicatedStack ? t('adminErrors.detail.stackResolved') : t('adminErrors.detail.stack')}</h4>
                  {e.symbolicatedStack || e.stack ? (
                    <pre className="ui-panel ui-mono overflow-x-auto p-2 whitespace-pre">{e.symbolicatedStack ?? e.stack}</pre>
                  ) : (
                    <p className="ui-small">{t('adminErrors.detail.noStack')}</p>
                  )}
                </div>
                {e.symbolicatedContext && e.symbolicatedContext.length > 0 && (
                  <div className="grid gap-1">
                    <h4 className="ui-small ui-strong">{t('adminErrors.detail.context')}</h4>
                    {e.symbolicatedContext.map((c) => (
                      <div key={c.location} className="grid gap-1">
                        <p className="ui-mono break-all">{c.location}</p>
                        <pre className="ui-panel ui-mono overflow-x-auto p-2 whitespace-pre">
                          {c.lines.map((line, i) => `${String(c.startLine + i).padStart(5)}${i === c.focus ? ' >' : '  '} ${line}`).join('\n')}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
                {e.symbolicatedStack && e.stack && (
                  <Accordion>
                    <AccordionItem title={t('adminErrors.detail.stackRaw')}>
                      <pre className="ui-panel ui-mono overflow-x-auto p-2 whitespace-pre">{e.stack}</pre>
                    </AccordionItem>
                  </Accordion>
                )}
                <div className="grid gap-1">
                  <h4 className="ui-small ui-strong">{t('adminErrors.detail.breadcrumbs')}</h4>
                  {e.breadcrumbs.length === 0 ? (
                    <p className="ui-small">{t('adminErrors.detail.noBreadcrumbs')}</p>
                  ) : (
                    <ol className="ui-mono grid gap-0.5">
                      {e.breadcrumbs.map((b, i) => (
                        <li key={i}>
                          {b.at.slice(11, 19)} {b.type} {b.message}
                          {b.data ? ` ${Object.entries(b.data).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
