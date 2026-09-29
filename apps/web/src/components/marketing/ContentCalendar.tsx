'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CALENDAR_CHANNELS,
  CALENDAR_STATUSES,
  isCalendarItemMovable,
  monthGridDates,
  toDateOnly,
  weekDates,
  type CalendarChannel,
  type CalendarOwnerDTO,
  type CalendarStatus,
  type ContentCalendarViewDTO,
  type ContentItemDTO,
  type MarketingDraftListDTO,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { AreaField, InputField, LinkButton, SelectField } from './fields';
import { usePlatformSession } from './PlatformSession';

type ViewMode = 'month' | 'week';

interface ItemForm {
  id: string | null;
  title: string;
  channel: CalendarChannel;
  scheduledDate: string;
  status: CalendarStatus;
  ownerUserId: string;
  draftId: string;
  socialPostId: string;
  notes: string;
}

const STATUS_COLOR: Record<CalendarStatus, string> = {
  PLANNED: 'var(--color-text-muted)',
  DRAFTED: 'var(--color-primary)',
  APPROVED: 'var(--color-success)',
  SENT: 'var(--color-text-secondary)',
  CANCELLED: 'var(--color-danger)',
};

const newForm = (date: string): ItemForm => ({ id: null, title: '', channel: 'EMAIL', scheduledDate: date, status: 'PLANNED', ownerUserId: '', draftId: '', socialPostId: '', notes: '' });

function formOf(item: ContentItemDTO): ItemForm {
  return {
    id: item.id,
    title: item.title,
    channel: item.channel,
    scheduledDate: item.scheduledDate,
    status: item.status,
    ownerUserId: item.ownerUserId ?? '',
    draftId: item.draftId ?? '',
    socialPostId: item.socialPostId ?? '',
    notes: item.notes ?? '',
  };
}

/** Moves an anchor date by whole months or weeks; the month view lands on the 1st. */
function shift(anchor: string, mode: ViewMode, direction: -1 | 1): string {
  const d = new Date(`${anchor}T00:00:00.000Z`);
  if (mode === 'week') return toDateOnly(new Date(d.getTime() + direction * 7 * 86_400_000));
  return toDateOnly(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1)));
}

/**
 * Content calendar (/pazarlama/takvim, docs/PAZARLAMA_MODULU.md 3.4): month
 * and week views of planned content and, read-only, the platform's
 * campaigns. Items can be created, edited and moved (drag and drop, or the
 * date field); sent and cancelled items are locked. Nothing is sent or
 * published from here.
 */
export function ContentCalendar() {
  const t = useT();
  const locale = useLocale();
  const { permissions, isSuperAdmin } = usePlatformSession();
  const canManage = isSuperAdmin || permissions.includes('platform.marketing.manage');
  const canUseAi = isSuperAdmin || permissions.includes('platform.ai.use');
  const today = toDateOnly(new Date());
  const [mode, setMode] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState<ContentCalendarViewDTO | null>(null);
  const [owners, setOwners] = useState<CalendarOwnerDTO[]>([]);
  const [drafts, setDrafts] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState<ItemForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const dates = useMemo(() => {
    if (mode === 'week') return weekDates(anchor);
    const d = new Date(`${anchor}T00:00:00.000Z`);
    return monthGridDates(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }, [mode, anchor]);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const anchorMonth = anchor.slice(0, 7);

  const load = useCallback(() => {
    bffFetch<ContentCalendarViewDTO>(`platform/marketing/calendar?from=${from}&to=${to}`)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('contentCalendar.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(load, [load]);
  useEffect(() => {
    bffFetch<CalendarOwnerDTO[]>('platform/marketing/calendar/owners')
      .then(setOwners)
      .catch(() => setOwners([]));
  }, []);
  useEffect(() => {
    if (!canUseAi) return;
    bffFetch<MarketingDraftListDTO>('platform/marketing/studio/drafts?limit=100')
      .then((res) => setDrafts(res.items.map((d) => ({ id: d.id, title: `${d.kind} - ${d.title}`.slice(0, 80) }))))
      .catch(() => setDrafts([]));
  }, [canUseAi]);

  const fmtDay = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), [locale]);
  const weekday = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }), [locale]);
  const title = useMemo(
    () =>
      mode === 'month'
        ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor}T00:00:00.000Z`))
        : `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${from}T00:00:00.000Z`))} - ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${to}T00:00:00.000Z`))}`,
    [mode, anchor, from, to, locale],
  );

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  const byDate = new Map<string, { items: ContentItemDTO[]; campaigns: ContentCalendarViewDTO['campaigns'] }>();
  for (const date of dates) byDate.set(date, { items: [], campaigns: [] });
  for (const item of data.items) byDate.get(item.scheduledDate)?.items.push(item);
  for (const c of data.campaigns) byDate.get(c.scheduledDate)?.campaigns.push(c);

  async function move(id: string, date: string) {
    const item = data?.items.find((i) => i.id === id);
    if (!item || item.scheduledDate === date || !canManage || !isCalendarItemMovable(item.status)) return;
    setMessage(null);
    try {
      await bffFetch(`platform/marketing/calendar/items/${id}`, { method: 'PATCH', body: { scheduledDate: date } });
      load();
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    }
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    const body = {
      title: form.title.trim(),
      channel: form.channel,
      scheduledDate: form.scheduledDate,
      status: form.status,
      ownerUserId: form.ownerUserId || null,
      draftId: form.draftId || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (form.id) await bffFetch(`platform/marketing/calendar/items/${form.id}`, { method: 'PATCH', body });
      else await bffFetch('platform/marketing/calendar/items', { method: 'POST', body });
      setForm(null);
      load();
    } catch (err) {
      setMessage({ text: err instanceof BffError && err.status === 400 && !err.code ? t('contentCalendar.invalid') : marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form?.id || !window.confirm(t('contentCalendar.confirmDelete'))) return;
    setBusy(true);
    try {
      await bffFetch(`platform/marketing/calendar/items/${form.id}`, { method: 'DELETE' });
      setForm(null);
      load();
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const locked = form?.id ? !isCalendarItemMovable(data.items.find((i) => i.id === form.id)?.status ?? 'PLANNED') : false;

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('contentCalendar.title')} description={t('contentCalendar.subtitle')} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('contentCalendar.noSend')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('contentCalendar.view')} className="flex gap-1">
          {(['month', 'week'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="px-3 py-1.5 text-sm font-medium"
              style={{
                borderRadius: 'var(--radius-chip)',
                color: mode === m ? 'var(--color-on-primary)' : 'var(--color-text-secondary)',
                backgroundColor: mode === m ? 'var(--color-primary)' : 'transparent',
              }}
            >
              {t(`contentCalendar.mode.${m}`)}
            </button>
          ))}
        </div>
        <SecondaryButton onClick={() => setAnchor(shift(anchor, mode, -1))}>{t('contentCalendar.prev')}</SecondaryButton>
        <SecondaryButton onClick={() => setAnchor(today)}>{t('contentCalendar.today')}</SecondaryButton>
        <SecondaryButton onClick={() => setAnchor(shift(anchor, mode, 1))}>{t('contentCalendar.next')}</SecondaryButton>
        <h3 className="text-sm font-semibold capitalize" style={{ color: 'var(--color-text-primary)' }} aria-live="polite">
          {title}
        </h3>
        {canManage && (
          <div className="ml-auto">
            <PrimaryButton onClick={() => setForm(newForm(mode === 'month' && !today.startsWith(anchorMonth) ? `${anchorMonth}-01` : today))}>{t('contentCalendar.new')}</PrimaryButton>
          </div>
        )}
      </div>
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <div className="overflow-x-auto">
        <div className="min-w-[840px]" role="grid" aria-label={title}>
          <div className="grid grid-cols-7 gap-px" role="row">
            {dates.slice(0, 7).map((date) => (
              <div key={date} role="columnheader" className="px-2 py-1 text-xs font-medium capitalize" style={{ color: 'var(--color-text-muted)' }}>
                {weekday.format(new Date(`${date}T00:00:00.000Z`))}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px border" style={{ backgroundColor: 'var(--color-border)', borderColor: 'var(--color-border)' }}>
            {dates.map((date) => {
              const cell = byDate.get(date)!;
              const outside = mode === 'month' && !date.startsWith(anchorMonth);
              return (
                <div
                  key={date}
                  role="gridcell"
                  aria-label={fmtDay.format(new Date(`${date}T00:00:00.000Z`))}
                  onDragOver={(e) => canManage && dragging && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain') || dragging;
                    setDragging(null);
                    if (id) void move(id, date);
                  }}
                  className="p-1.5 space-y-1 align-top"
                  style={{
                    backgroundColor: outside ? 'var(--color-surface-muted)' : 'var(--color-surface)',
                    minHeight: mode === 'week' ? 240 : 110,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: date === today ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: date === today ? 700 : 400 }}
                    >
                      {Number(date.slice(8))}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        aria-label={t('contentCalendar.addOn', { date: fmtDay.format(new Date(`${date}T00:00:00.000Z`)) })}
                        onClick={() => setForm(newForm(date))}
                        className="text-xs px-1"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        +
                      </button>
                    )}
                  </div>
                  {cell.items.map((item) => {
                    const movable = canManage && isCalendarItemMovable(item.status);
                    return (
                      <div key={item.id}>
                        <button
                          type="button"
                          draggable={movable}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', item.id);
                            setDragging(item.id);
                          }}
                          onDragEnd={() => setDragging(null)}
                          onClick={() => setForm(formOf(item))}
                          className="w-full text-left text-xs px-1.5 py-1 border-l-2 truncate"
                          style={{
                            borderColor: STATUS_COLOR[item.status],
                            backgroundColor: 'var(--color-surface-muted)',
                            color: 'var(--color-text-primary)',
                            textDecoration: item.status === 'CANCELLED' ? 'line-through' : undefined,
                            cursor: movable ? 'grab' : 'pointer',
                          }}
                          title={`${item.title} (${t(`contentCalendar.status.${item.status}`)})`}
                        >
                          <span className="font-medium">{t(`contentCalendar.channel.${item.channel}`)}</span> {item.title}
                        </button>
                        {item.channel === 'SOCIAL' && item.socialPostId && (
                          <Link href={`/pazarlama/sosyal?id=${encodeURIComponent(item.socialPostId)}`} className="block text-xs px-1.5 underline" style={{ color: 'var(--color-text-secondary)' }}>
                            {t('contentCalendar.social.open')}
                          </Link>
                        )}
                      </div>
                    );
                  })}
                  {cell.campaigns.map((c) => (
                    <Link
                      key={c.id}
                      href={`/pazarlama/kampanyalar/${c.id}`}
                      className="block text-xs px-1.5 py-1 border border-dashed truncate"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                      title={`${c.name} (${c.status})`}
                    >
                      {t('contentCalendar.campaign')}: {c.name}
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="flex flex-wrap gap-3 text-xs" aria-label={t('contentCalendar.legend')}>
        {CALENDAR_STATUSES.map((s) => (
          <li key={s} className="flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="inline-block w-2 h-2" style={{ backgroundColor: STATUS_COLOR[s], borderRadius: 'var(--radius-chip)' }} />
            {t(`contentCalendar.status.${s}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-block w-3 h-2 border border-dashed" style={{ borderColor: 'var(--color-border)' }} />
          {t('contentCalendar.campaignLegend')}
        </li>
      </ul>

      {form && (
        <Section title={form.id ? t('contentCalendar.edit') : t('contentCalendar.create')}>
          {locked && <InlineMessage text={t('contentCalendar.lockedNote')} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InputField label={t('contentCalendar.field.title')} value={form.title} onChange={(v) => setForm({ ...form, title: v })} disabled={!canManage} />
            <InputField label={t('contentCalendar.field.date')} type="date" value={form.scheduledDate} onChange={(v) => setForm({ ...form, scheduledDate: v })} disabled={!canManage || locked} />
            <SelectField
              label={t('contentCalendar.field.channel')}
              value={form.channel}
              onChange={(v) => setForm({ ...form, channel: v as CalendarChannel })}
              options={CALENDAR_CHANNELS.map((c) => ({ value: c, label: t(`contentCalendar.channel.${c}`) }))}
              disabled={!canManage}
            />
            <SelectField
              label={t('contentCalendar.field.status')}
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v as CalendarStatus })}
              options={CALENDAR_STATUSES.map((s) => ({ value: s, label: t(`contentCalendar.status.${s}`) }))}
              disabled={!canManage}
            />
            <SelectField
              label={t('contentCalendar.field.owner')}
              value={form.ownerUserId}
              onChange={(v) => setForm({ ...form, ownerUserId: v })}
              options={[{ value: '', label: t('contentCalendar.field.noOwner') }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
              disabled={!canManage}
            />
            {canUseAi && (
              <SelectField
                label={t('contentCalendar.field.draft')}
                value={form.draftId}
                onChange={(v) => setForm({ ...form, draftId: v })}
                options={[
                  { value: '', label: t('contentCalendar.field.noDraft') },
                  ...(form.draftId && !drafts.some((d) => d.id === form.draftId) ? [{ value: form.draftId, label: form.draftId.slice(0, 8) }] : []),
                  ...drafts.map((d) => ({ value: d.id, label: d.title })),
                ]}
                disabled={!canManage}
              />
            )}
          </div>
          <AreaField label={t('contentCalendar.field.notes')} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} disabled={!canManage} />
          {form.id && form.channel === 'SOCIAL' && (
            <Link
              href={
                form.socialPostId
                  ? `/pazarlama/sosyal?id=${encodeURIComponent(form.socialPostId)}`
                  : `/pazarlama/sosyal?calendarItemId=${encodeURIComponent(form.id)}&title=${encodeURIComponent(form.title)}`
              }
              className="text-xs underline"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {form.socialPostId ? t('contentCalendar.social.open') : t('contentCalendar.social.create')}
            </Link>
          )}
          {form.draftId && (
            <Link href="/pazarlama/yapay-zeka" className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
              {t('contentCalendar.openStudio')}
            </Link>
          )}
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton onClick={save} disabled={busy || form.title.trim() === '' || form.scheduledDate === ''}>
                {t('contentCalendar.save')}
              </PrimaryButton>
              <SecondaryButton onClick={() => setForm(null)}>{t('contentCalendar.cancel')}</SecondaryButton>
              {form.id && (
                <LinkButton danger onClick={remove} disabled={busy}>
                  {t('contentCalendar.delete')}
                </LinkButton>
              )}
            </div>
          )}
          {!canManage && <SecondaryButton onClick={() => setForm(null)}>{t('contentCalendar.close')}</SecondaryButton>}
        </Section>
      )}
      {data.items.length === 0 && data.campaigns.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('contentCalendar.empty')} <Badge>{title}</Badge>
        </p>
      )}
    </div>
  );
}
