'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EVENT_KINDS, EVENT_VISIBILITIES } from '@platform/shared';
import type { EventDTO, EventKind, EventVisibility } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { BranchSelect } from '@/components/common/BranchSelect';
import { bffFetch } from '@/lib/session/client';
import { Field, Notice, PageHeader, Panel } from '@/components/growth/ui';
import { Input, LinkButton, Select, Textarea } from '@/components/ui';
import { PrimaryButton, Toggle } from '@/components/settings/ui';
import { eventErrorMessage, fromLocalInput } from '@/components/events/labels';

function NewEventForm() {
  const t = useT();
  const router = useRouter();
  const { activeStudioId } = useDashboardSession();
  const [kind, setKind] = useState<EventKind>('SINGLE');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');
  const [capacity, setCapacity] = useState('10');
  const [waitlist, setWaitlist] = useState(true);
  const [visibility, setVisibility] = useState<EventVisibility>('MEMBERS_ONLY');
  const [refundHours, setRefundHours] = useState('24');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const startsAt = fromLocalInput(start);
    const endsAt = fromLocalInput(end);
    try {
      const created = await bffFetch<EventDTO>(`studios/${activeStudioId}/events`, {
        method: 'POST',
        studioId: activeStudioId,
        body: {
          kind,
          title: title.trim(),
          description: description.trim() || null,
          branchId: branchId || null,
          capacity: Math.max(1, Number(capacity) || 1),
          waitlistEnabled: waitlist,
          visibility,
          fullRefundHoursBefore: Math.max(0, Number(refundHours) || 0),
          occurrences: startsAt && endsAt ? [{ startsAt, endsAt }] : [],
        },
      });
      router.push(`/etkinlikler/${created.id}`);
    } catch (err) {
      setError(eventErrorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <LinkButton href="/etkinlikler" variant="link" tone="surface" size="sm">
          {t('events.back')}
        </LinkButton>
      </div>
      <PageHeader title={t('events.newTitle')} />
      <form onSubmit={submit}>
        <Panel>
          <Field label={t('events.form.kind')} htmlFor="event-kind">
            <Select id="event-kind" value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`events.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('events.form.title')} htmlFor="event-title">
            <Input id="event-title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('events.form.description')} htmlFor="event-description">
            <Textarea id="event-description" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <BranchSelect value={branchId} onChange={setBranchId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('events.form.capacity')} htmlFor="event-capacity">
              <Input id="event-capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
            <Field label={t('events.form.refundHours')} htmlFor="event-refund-hours">
              <Input id="event-refund-hours" type="number" min={0} value={refundHours} onChange={(e) => setRefundHours(e.target.value)} />
            </Field>
          </div>
          <Field label={t('events.form.visibility')} htmlFor="event-visibility">
            <Select id="event-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as EventVisibility)}>
              {EVENT_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`events.visibility.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle label={t('events.form.waitlist')} checked={waitlist} onChange={setWaitlist} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('events.form.firstStart')} htmlFor="event-start">
              <Input id="event-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t('events.form.firstEnd')} htmlFor="event-end">
              <Input id="event-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <PrimaryButton type="submit" disabled={busy || !title.trim()}>
            {t('events.form.create')}
          </PrimaryButton>
        </Panel>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <PageGuard required={['events.manage']}>
      <NewEventForm />
    </PageGuard>
  );
}
