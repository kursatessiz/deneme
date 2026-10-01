'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EVENT_DESK_PAYMENT_METHODS, EVENT_VISIBILITIES } from '@platform/shared';
import type {
  EventCancelResultDTO,
  EventDTO,
  EventDeskPaymentMethod,
  EventRegistrationDTO,
  EventTicketTypeDTO,
  EventVisibility,
} from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { Badge } from '@/components/common/Badge';
import { Tabs } from '@/components/common/Tabs';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { hasAnyPermission } from '@/lib/nav';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { Field, Muted, Notice, PageHeader, Panel, useDateFormat } from '@/components/growth/ui';
import { AnchorButton, Card, Input, LinkButton, List, ListItem, Select, Table, Tbody, Td, Textarea, Th, Thead, Tr } from '@/components/ui';
import { PrimaryButton, SecondaryButton, Toggle } from '@/components/settings/ui';
import { eventErrorMessage, fromLocalInput, toLocalInput } from '@/components/events/labels';

type Message = { text: string; tone: 'success' | 'error' } | null;

function useRunner(onDone: () => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const run = async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (success) setMessage({ text: success, tone: 'success' });
      onDone();
      return true;
    } catch (err) {
      setMessage({ text: eventErrorMessage(err, t), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, run };
}

// ---------------------------------------------------------------------------
// Details, publish and cancel
// ---------------------------------------------------------------------------

function DetailsTab({ event, canManage, onChanged }: { event: EventDTO; canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const editable = canManage && (event.status === 'DRAFT' || event.status === 'PUBLISHED');
  const [form, setForm] = useState({
    title: event.title,
    description: event.description ?? '',
    capacity: String(event.capacity),
    waitlistEnabled: event.waitlistEnabled,
    visibility: event.visibility,
    fullRefundHoursBefore: String(event.fullRefundHoursBefore),
    registrationOpensAt: toLocalInput(event.registrationOpensAt),
    registrationClosesAt: toLocalInput(event.registrationClosesAt),
    coverImageUrl: event.coverImageUrl ?? '',
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const { busy, message, run } = useRunner(onChanged);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const base = `studios/${activeStudioId}/events/${event.id}`;

  const save = () =>
    run(
      () =>
        bffFetch(base, {
          method: 'PATCH',
          studioId: activeStudioId,
          body: {
            title: form.title.trim(),
            description: form.description.trim() || null,
            capacity: Math.max(1, Number(form.capacity) || 1),
            waitlistEnabled: form.waitlistEnabled,
            visibility: form.visibility,
            fullRefundHoursBefore: Math.max(0, Number(form.fullRefundHoursBefore) || 0),
            registrationOpensAt: fromLocalInput(form.registrationOpensAt),
            registrationClosesAt: fromLocalInput(form.registrationClosesAt),
            coverImageUrl: form.coverImageUrl.trim() || null,
          },
        }),
      t('events.form.saved'),
    );

  const publish = () => run(() => bffFetch(`${base}/publish`, { method: 'POST', studioId: activeStudioId }), t('events.published'));

  const cancel = async () => {
    let result: EventCancelResultDTO | null = null;
    const ok = await run(async () => {
      result = await bffFetch<EventCancelResultDTO>(`${base}/cancel`, { method: 'POST', studioId: activeStudioId, body: { reason: reason.trim() || null, notify } });
    });
    const done = result as EventCancelResultDTO | null;
    if (ok && done) {
      setCancelOpen(false);
      setCancelMessage(t('events.cancelledResult', { count: done.cancelledRegistrations, refunded: done.refundedPayments }));
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {!editable && <Muted>{t('events.form.readOnly')}</Muted>}
      <Panel>
        <Field label={t('events.form.title')} htmlFor="event-title">
          <Input id="event-title" disabled={!editable} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label={t('events.form.description')} htmlFor="event-description">
          <Textarea
            id="event-description"
            rows={3}
            disabled={!editable}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('events.form.capacity')} htmlFor="event-capacity">
            <Input
              id="event-capacity"
              type="number"
              min={1}
              disabled={!editable}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
          </Field>
          <Field label={t('events.form.refundHours')} htmlFor="event-refund-hours">
            <Input
              id="event-refund-hours"
              type="number"
              min={0}
              disabled={!editable}
              value={form.fullRefundHoursBefore}
              onChange={(e) => setForm({ ...form, fullRefundHoursBefore: e.target.value })}
            />
          </Field>
          <Field label={t('events.form.opensAt')} htmlFor="event-opens">
            <Input
              id="event-opens"
              type="datetime-local"
              disabled={!editable}
              value={form.registrationOpensAt}
              onChange={(e) => setForm({ ...form, registrationOpensAt: e.target.value })}
            />
          </Field>
          <Field label={t('events.form.closesAt')} htmlFor="event-closes">
            <Input
              id="event-closes"
              type="datetime-local"
              disabled={!editable}
              value={form.registrationClosesAt}
              onChange={(e) => setForm({ ...form, registrationClosesAt: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('events.form.visibility')} htmlFor="event-visibility">
          <Select
            id="event-visibility"
            disabled={!editable}
            value={form.visibility}
            onChange={(e) => setForm({ ...form, visibility: e.target.value as EventVisibility })}
          >
            {EVENT_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(`events.visibility.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('events.form.coverImageUrl')} htmlFor="event-cover">
          <Input id="event-cover" disabled={!editable} value={form.coverImageUrl} onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })} />
        </Field>
        <Toggle label={t('events.form.waitlist')} checked={form.waitlistEnabled} disabled={!editable} onChange={(v) => setForm({ ...form, waitlistEnabled: v })} />
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {editable && (
          <div className="flex flex-wrap gap-2">
            <PrimaryButton onClick={save} disabled={busy || !form.title.trim()}>
              {t('events.form.save')}
            </PrimaryButton>
            {event.status === 'DRAFT' && (
              <SecondaryButton onClick={publish} disabled={busy}>
                {t('events.publish')}
              </SecondaryButton>
            )}
            <SecondaryButton danger onClick={() => setCancelOpen(true)} disabled={busy}>
              {t('events.cancel')}
            </SecondaryButton>
          </div>
        )}
      </Panel>
      {cancelMessage && <Notice tone="success">{cancelMessage}</Notice>}
      {cancelOpen && editable && (
        <Panel title={t('events.cancel')}>
          <Muted>{t('events.cancelHint')}</Muted>
          <Field label={t('events.cancelReason')} htmlFor="event-cancel-reason">
            <Input id="event-cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Toggle label={t('events.cancelNotify')} checked={notify} onChange={setNotify} />
          <SecondaryButton danger onClick={cancel} disabled={busy}>
            {t('events.cancelConfirm')}
          </SecondaryButton>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

function OccurrencesTab({ event, canManage, onChanged }: { event: EventDTO; canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const { activeStudioId } = useDashboardSession();
  const editable = canManage && (event.status === 'DRAFT' || event.status === 'PUBLISHED');
  const [rows, setRows] = useState(() => event.occurrences.map((o) => ({ start: toLocalInput(o.startsAt), end: toLocalInput(o.endsAt) })));
  const { busy, message, run } = useRunner(onChanged);
  const single = event.kind === 'SINGLE';

  const save = () =>
    run(
      () =>
        bffFetch(`studios/${activeStudioId}/events/${event.id}/occurrences`, {
          method: 'PUT',
          studioId: activeStudioId,
          body: {
            occurrences: rows
              .map((r) => ({ startsAt: fromLocalInput(r.start), endsAt: fromLocalInput(r.end) }))
              .filter((r): r is { startsAt: string; endsAt: string } => Boolean(r.startsAt && r.endsAt)),
          },
        }),
      t('events.occ.saved'),
    );

  return (
    <div className="space-y-4 max-w-2xl">
      {single && <Muted>{t('events.occ.singleHint')}</Muted>}
      <Panel>
        {rows.length === 0 && <Muted>{t('events.occ.empty')}</Muted>}
        <ul className="space-y-2" data-testid="event-occurrences">
          {rows.map((row, i) => (
            <li key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <Field label={t('events.occ.start')} htmlFor={`occ-start-${i}`}>
                <Input
                  id={`occ-start-${i}`}
                  type="datetime-local"
                  disabled={!editable}
                  value={row.start}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, start: e.target.value } : r)))}
                />
              </Field>
              <Field label={t('events.occ.end')} htmlFor={`occ-end-${i}`}>
                <Input
                  id={`occ-end-${i}`}
                  type="datetime-local"
                  disabled={!editable}
                  value={row.end}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, end: e.target.value } : r)))}
                />
              </Field>
              {editable && !single && (
                <SecondaryButton onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t('events.occ.remove')}</SecondaryButton>
              )}
            </li>
          ))}
        </ul>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {editable && (
          <div className="flex flex-wrap gap-2">
            {(!single || rows.length === 0) && (
              <SecondaryButton onClick={() => setRows([...rows, { start: '', end: '' }])}>{t('events.occ.add')}</SecondaryButton>
            )}
            <PrimaryButton onClick={save} disabled={busy || rows.length === 0}>
              {t('events.occ.save')}
            </PrimaryButton>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function TicketsTab({ event, canManage, onChanged }: { event: EventDTO; canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId, currency } = useDashboardSession();
  const editable = canManage && (event.status === 'DRAFT' || event.status === 'PUBLISHED');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [quantity, setQuantity] = useState('');
  const [membersOnly, setMembersOnly] = useState(false);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const { busy, message, run } = useRunner(onChanged);
  const base = `studios/${activeStudioId}/events/${event.id}/tickets`;

  const add = async () => {
    const ok = await run(() =>
      bffFetch(base, {
        method: 'POST',
        studioId: activeStudioId,
        body: {
          name: name.trim(),
          priceAmount: Math.max(0, Number(price) || 0),
          currency,
          quantityLimit: quantity ? Math.max(1, Number(quantity) || 1) : null,
          membersOnly,
          allowMultiple,
        },
      }),
    );
    if (ok) {
      setName('');
      setPrice('0');
      setQuantity('');
    }
  };

  const summary = (ticket: EventTicketTypeDTO) => {
    const parts = [Number(ticket.priceAmount) > 0 ? formatMoney(ticket.priceAmount, ticket.currency, locale) : t('events.tickets.free')];
    parts.push(ticket.quantityLimit ? t('events.tickets.soldOfLimit', { sold: ticket.soldCount, limit: ticket.quantityLimit }) : t('events.tickets.sold', { sold: ticket.soldCount }));
    if (ticket.creditUnits) parts.push(t('events.tickets.credits', { units: ticket.creditUnits }));
    return parts.join(' - ');
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Panel>
        {event.ticketTypes.length === 0 && <Muted>{t('events.tickets.empty')}</Muted>}
        <List data-testid="event-tickets">
          {event.ticketTypes.map((ticket) => (
            <ListItem key={ticket.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="ui-strong">{ticket.name}</p>
                <p className="ui-caption">{summary(ticket)}</p>
                <div className="flex gap-1 mt-1">
                  {!ticket.isActive && <Badge>{t('events.tickets.inactive')}</Badge>}
                  {ticket.membersOnly && <Badge>{t('events.tickets.membersOnlyBadge')}</Badge>}
                </div>
              </div>
              {editable && (
                <div className="flex gap-2">
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => run(() => bffFetch(`${base}/${ticket.id}`, { method: 'PATCH', studioId: activeStudioId, body: { isActive: !ticket.isActive } }))}
                  >
                    {ticket.isActive ? t('events.tickets.deactivate') : t('events.tickets.activate')}
                  </SecondaryButton>
                  {ticket.soldCount === 0 && (
                    <SecondaryButton danger disabled={busy} onClick={() => run(() => bffFetch(`${base}/${ticket.id}`, { method: 'DELETE', studioId: activeStudioId }))}>
                      {t('events.tickets.delete')}
                    </SecondaryButton>
                  )}
                </div>
              )}
            </ListItem>
          ))}
        </List>
      </Panel>
      {editable && (
        <Panel title={t('events.tickets.new')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('events.tickets.name')} htmlFor="ticket-name">
              <Input id="ticket-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('events.tickets.price', { currency })} htmlFor="ticket-price">
              <Input id="ticket-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label={t('events.tickets.quantity')} htmlFor="ticket-quantity">
              <Input id="ticket-quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <Toggle label={t('events.tickets.membersOnly')} checked={membersOnly} onChange={setMembersOnly} />
          <Toggle label={t('events.tickets.allowMultiple')} checked={allowMultiple} onChange={setAllowMultiple} />
          <PrimaryButton onClick={add} disabled={busy || !name.trim()}>
            {t('events.tickets.add')}
          </PrimaryButton>
        </Panel>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

function RegistrationsTab({ event }: { event: EventDTO }) {
  const t = useT();
  const locale = useLocale();
  const fmt = useDateFormat();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['events.manage'], permissions, isOwner);
  const canCheckIn = hasAnyPermission(['events.checkin'], permissions, isOwner);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useBff<{ items: EventRegistrationDTO[] }>(`studios/${activeStudioId}/events/${event.id}/registrations`, activeStudioId, refreshKey);
  const { busy, message, run } = useRunner(() => setRefreshKey((k) => k + 1));
  const [method, setMethod] = useState<EventDeskPaymentMethod>('CASH');
  const base = `studios/${activeStudioId}/events/registrations`;
  const items = data?.items ?? [];
  const counts = useMemo(
    () => ({
      confirmed: items.filter((r) => r.status === 'CONFIRMED').length,
      attended: items.filter((r) => r.status === 'ATTENDED').length,
      waitlist: items.filter((r) => r.status === 'WAITLIST').length,
    }),
    [items],
  );

  const act = (id: string, action: 'check-in' | 'no-show' | 'cancel' | 'payment') =>
    run(
      () =>
        bffFetch(`${base}/${id}/${action}`, {
          method: 'POST',
          studioId: activeStudioId,
          body: action === 'payment' ? { paymentMethod: method } : action === 'cancel' ? {} : undefined,
        }),
      t('events.reg.updated'),
    );

  const paymentLine = (r: EventRegistrationDTO) => {
    if (r.unitsCharged > 0) return t('events.reg.credits', { count: r.unitsCharged });
    if (Number(r.amountDue) === 0) return t('events.tickets.free');
    const lines = [
      r.status === 'PENDING_PAYMENT' ? t('events.reg.due', { amount: formatMoney(r.amountDue, r.currency, locale) }) : t('events.reg.paid', { amount: formatMoney(r.amountPaid, r.currency, locale) }),
    ];
    if (Number(r.refundedAmount) > 0) lines.push(t('events.reg.refunded', { amount: formatMoney(r.refundedAmount, r.currency, locale) }));
    return lines.join(' - ');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Muted>{t('events.reg.count', counts)}</Muted>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Select aria-label={t('events.reg.paymentMethod')} value={method} onChange={(e) => setMethod(e.target.value as EventDeskPaymentMethod)}>
              {EVENT_DESK_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`events.paymentMethod.${m}`)}
                </option>
              ))}
            </Select>
          )}
          <AnchorButton
            variant="outline"
            tone="surface"
            size="sm"
            href={`/api/bff/studios/${activeStudioId}/events/${event.id}/registrations/export.csv?locale=${encodeURIComponent(locale)}`}
          >
            {t('events.reg.export')}
          </AnchorButton>
        </div>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {loading && !data && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && items.length === 0 && <Muted>{t('events.reg.empty')}</Muted>}
      {items.length > 0 && (
        <Card className="overflow-x-auto">
          <Table aria-label={t('events.tab.registrations')}>
            <Thead>
              <Tr>
                <Th>{t('events.reg.col.person')}</Th>
                <Th>{t('events.reg.col.ticket')}</Th>
                <Th>{t('events.reg.col.status')}</Th>
                <Th>{t('events.reg.col.payment')}</Th>
                <Th>{t('events.reg.col.actions')}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((r) => (
                <Tr key={r.id} className="align-top">
                  <Td>
                    <p className="ui-strong">{r.displayName}</p>
                    <p className="ui-caption">{[r.phone, t(`events.reg.source.${r.source}`)].filter(Boolean).join(' - ')}</p>
                  </Td>
                  <Td className="ui-small">{r.ticketTypeName}</Td>
                  <Td>
                    <Badge>{t(`events.registrationStatus.${r.status}`)}</Badge>
                    {r.waitlistPosition !== null && <p className="ui-caption mt-1">{t('events.reg.waitlistPosition', { position: r.waitlistPosition })}</p>}
                    {r.checkedInAt && <p className="ui-caption mt-1">{t('events.reg.checkedInAt', { time: fmt.dateTime(r.checkedInAt) })}</p>}
                  </Td>
                  <Td className="ui-small">{paymentLine(r)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {canCheckIn && (r.status === 'CONFIRMED' || r.status === 'NO_SHOW') && (
                        <SecondaryButton disabled={busy} onClick={() => act(r.id, 'check-in')}>
                          {t('events.reg.checkIn')}
                        </SecondaryButton>
                      )}
                      {canCheckIn && r.status === 'CONFIRMED' && event.startsAt && new Date(event.startsAt) <= new Date() && (
                        <SecondaryButton disabled={busy} onClick={() => act(r.id, 'no-show')}>
                          {t('events.reg.noShow')}
                        </SecondaryButton>
                      )}
                      {canManage && r.status === 'PENDING_PAYMENT' && (
                        <SecondaryButton disabled={busy} onClick={() => act(r.id, 'payment')}>
                          {t('events.reg.recordPayment')}
                        </SecondaryButton>
                      )}
                      {canManage && (r.status === 'CONFIRMED' || r.status === 'PENDING_PAYMENT' || r.status === 'WAITLIST') && (
                        <SecondaryButton danger disabled={busy} onClick={() => act(r.id, 'cancel')}>
                          {t('events.reg.cancel')}
                        </SecondaryButton>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EventEditor() {
  const t = useT();
  const fmt = useDateFormat();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canManage = hasAnyPermission(['events.manage'], permissions, isOwner);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, forbidden } = useBff<EventDTO>(activeStudioId ? `studios/${activeStudioId}/events/${eventId}` : null, activeStudioId, refreshKey);
  const [tab, setTab] = useState('details');
  const [event, setEvent] = useState<EventDTO | null>(null);

  useEffect(() => {
    if (data) setEvent(data);
  }, [data]);

  if (forbidden) return <ErrorState message={t('events.forbidden')} />;
  if (loading && !event) return <LoadingState />;
  if (error && !event) return <ErrorState message={error} />;
  if (!event) return null;

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <div>
        <LinkButton href="/etkinlikler" variant="link" tone="surface" size="sm">
          {t('events.back')}
        </LinkButton>
      </div>
      <PageHeader
        title={event.title}
        subtitle={[t(`events.kind.${event.kind}`), event.startsAt ? fmt.dateTime(event.startsAt) : t('events.noDate')].join(' - ')}
        actions={<Badge>{t(`events.status.${event.status}`)}</Badge>}
      />
      <div className="flex flex-wrap gap-4 ui-text-muted">
        <span>{t('events.summary.seats', { taken: fmt.number(event.seatsTaken), capacity: fmt.number(event.capacity) })}</span>
        {event.waitlistEnabled && <span>{t('events.summary.waitlist', { count: event.waitlistCount })}</span>}
      </div>
      <Tabs
        tabs={[
          { key: 'details', label: t('events.tab.details') },
          { key: 'occurrences', label: t('events.tab.occurrences') },
          { key: 'tickets', label: t('events.tab.tickets') },
          { key: 'registrations', label: t('events.tab.registrations') },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'details' && <DetailsTab event={event} canManage={canManage} onChanged={refresh} />}
      {tab === 'occurrences' && <OccurrencesTab event={event} canManage={canManage} onChanged={refresh} />}
      {tab === 'tickets' && <TicketsTab event={event} canManage={canManage} onChanged={refresh} />}
      {tab === 'registrations' && <RegistrationsTab event={event} />}
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['events.view']}>
      <EventEditor />
    </PageGuard>
  );
}
