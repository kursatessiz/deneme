'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { APPROVAL_STATUSES, UNKNOWN_COUNTRY, type ApprovalListDTO, type ApprovalRequestDTO, type ApprovalStatus } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/DataState';
import { InlineMessage, PrimaryButton, SecondaryButton, SettingsHeader } from '@/components/settings/ui';
import { approvalErrorText } from '@/lib/marketing/errors';
import { AreaField, LinkButton, SelectField } from './fields';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function approvalStatusTone(status: ApprovalStatus): Tone {
  if (status === 'PENDING') return 'warning';
  if (status === 'APPROVED' || status === 'SELF_APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'neutral';
}

function useFormats() {
  const locale = useLocale();
  return {
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
    date: (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)),
    money: (currency: string, amount: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount)),
    country: (code: string) => {
      if (code === UNKNOWN_COUNTRY) return null;
      try {
        return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
      } catch {
        return code;
      }
    },
  };
}

/** The request id to open from the notification link (?id=...), read once on the client. */
function linkedRequestId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('id');
}

/**
 * Approval queue of the marketing panel (/pazarlama/onaylar, M3b): every
 * request with a status filter and a detail drawer with the precheck
 * summary. Approve and reject are shown only to super admins (`canDecide`
 * from the API); the requester and super admins may withdraw a pending
 * request. The API enforces the same rules.
 */
export function ApprovalsQueue() {
  const t = useT();
  const fmt = useFormats();
  const [status, setStatus] = useState<ApprovalStatus | ''>('PENDING');
  const [data, setData] = useState<ApprovalListDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ApprovalRequestDTO | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const query = status ? `?status=${status}` : '';
      setData(await bffFetch<ApprovalListDTO>(`platform/marketing/approvals${query}`));
    } catch {
      setError(t('marketingApprovals.loadFailed'));
    }
  }, [status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = linkedRequestId();
    if (!id) return;
    bffFetch<ApprovalRequestDTO>(`platform/marketing/approvals/${encodeURIComponent(id)}`)
      .then(setOpen)
      .catch(() => undefined);
  }, []);

  const statusOptions = [{ value: '', label: t('marketingApprovals.filter.all') }, ...APPROVAL_STATUSES.map((s) => ({ value: s, label: t(`marketingApprovals.status.${s}`) }))];

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('marketingApprovals.title')} description={t('marketingApprovals.subtitle')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <SelectField label={t('marketingApprovals.filter.label')} value={status} onChange={(v) => setStatus(v as ApprovalStatus | '')} options={statusOptions} />
        </div>
        {data && data.pendingCount > 0 && (
          <p className="text-sm" data-testid="approvals-pending-count" style={{ color: 'var(--color-text-secondary)' }}>
            {t(data.pendingCount === 1 ? 'marketingApprovals.pendingCount.one' : 'marketingApprovals.pendingCount.other', { count: fmt.number(data.pendingCount) })}
          </p>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState />
      ) : data.items.length === 0 ? (
        <EmptyState title={t('marketingApprovals.empty')} />
      ) : (
        <div className="overflow-x-auto border" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <th className="px-4 py-2 font-medium">{t('marketingApprovals.col.target')}</th>
                <th className="px-4 py-2 font-medium">{t('marketingApprovals.col.requester')}</th>
                <th className="px-4 py-2 font-medium">{t('marketingApprovals.col.status')}</th>
                <th className="px-4 py-2 font-medium text-right">{t('marketingApprovals.col.audience')}</th>
                <th className="px-4 py-2 font-medium">{t('marketingApprovals.col.created')}</th>
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">{t('marketingApprovals.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{item.summary.target.name}</span>
                    <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {t(`marketingApprovals.targetType.${item.targetType}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2">{item.requestedBy.name}</td>
                  <td className="px-4 py-2">
                    <Badge tone={approvalStatusTone(item.status)}>{t(`marketingApprovals.status.${item.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.number(item.summary.audience.total)}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {fmt.date(item.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <LinkButton onClick={() => setOpen(item)}>{t('marketingApprovals.open')}</LinkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ApprovalDrawer
          request={open}
          onClose={() => setOpen(null)}
          onChanged={(next) => {
            setOpen(next);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm">
      <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd className="col-span-2" style={{ color: 'var(--color-text-primary)' }}>
        {children}
      </dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `approval-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-1 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
      <h4 id={id} className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function ApprovalDrawer({ request, onClose, onChanged }: { request: ApprovalRequestDTO; onClose: () => void; onChanged: (next: ApprovalRequestDTO) => void }) {
  const t = useT();
  const fmt = useFormats();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const s = request.summary;
  const count = (n: number) => t(n === 1 ? 'marketingApprovals.findingCount.one' : 'marketingApprovals.findingCount.other', { count: fmt.number(n) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(action: 'approve' | 'reject' | 'cancel') {
    setBusy(true);
    setMessage(null);
    try {
      const body = note.trim() ? { note: note.trim() } : {};
      const next = await bffFetch<ApprovalRequestDTO>(`platform/marketing/approvals/${request.id}/${action}`, { method: 'POST', body });
      setNote('');
      setMessage({ tone: 'success', text: t(action === 'approve' ? 'marketingApprovals.action.approved' : action === 'reject' ? 'marketingApprovals.action.rejected' : 'marketingApprovals.action.cancelled') });
      onChanged(next);
    } catch (err) {
      setMessage({ tone: 'error', text: approvalErrorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const countries = Object.entries(s.countries).sort((a, b) => b[1] - a[1]);
  const regions = Object.entries(s.regions).filter((e): e is [string, number] => typeof e[1] === 'number');
  const currencies = Object.entries(s.cost.byCurrency);
  const messages = Object.entries(s.cost.messages).filter((e): e is [string, number] => typeof e[1] === 'number');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }} onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-drawer-title"
        className="h-full w-full max-w-xl overflow-y-auto p-5 space-y-4"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="approval-drawer-title" className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {s.target.name}
            </h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('marketingApprovals.detail.title')} · {t(`marketingApprovals.targetType.${request.targetType}`)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={approvalStatusTone(request.status)}>{t(`marketingApprovals.status.${request.status}`)}</Badge>
            <LinkButton onClick={onClose}>{t('marketingApprovals.detail.close')}</LinkButton>
          </div>
        </div>

        {s.invalidated && <InlineMessage text={t(`marketingApprovals.detail.invalidated.${s.invalidated.reason}`)} />}
        {s.selfApprovedBySuperAdmin && <InlineMessage text={t('marketingApprovals.detail.selfApprovedBySuperAdmin')} />}

        <dl>
          <Row label={t('marketingApprovals.detail.segment')}>{s.target.segmentName ?? '-'}</Row>
          <Row label={t('marketingApprovals.detail.channel')}>
            {s.target.channel ? t(`messaging.channel.${s.target.channel}`) : t('marketingApprovals.detail.channelDefault')}
          </Row>
          <Row label={t('marketingApprovals.detail.template')}>{s.target.templateKey ?? '-'}</Row>
          <Row label={t('marketingApprovals.detail.schedule')}>{s.requestedSchedule ? fmt.date(s.requestedSchedule) : t('marketingApprovals.detail.scheduleAsap')}</Row>
          <Row label={t('marketingApprovals.detail.requestedBy')}>
            {request.requestedBy.name} · {fmt.date(request.createdAt)}
          </Row>
          {request.status === 'PENDING' && <Row label={t('marketingApprovals.col.expires')}>{fmt.date(request.expiresAt)}</Row>}
          {request.decidedBy && (
            <Row label={t('marketingApprovals.detail.decidedBy')}>
              {request.decidedBy.name}
              {request.decidedAt ? ` · ${fmt.date(request.decidedAt)}` : ''}
            </Row>
          )}
          {request.decisionNote && <Row label={t('marketingApprovals.detail.decisionNote')}>{request.decisionNote}</Row>}
          {request.target && request.targetType === 'CAMPAIGN' && (
            <Row label={t('marketingApprovals.detail.campaignStatus')}>
              <span className="inline-flex flex-wrap items-center gap-2">
                <Badge>{t(`campaigns.status.${request.target.status}`)}</Badge>
                <Link href={`/pazarlama/kampanyalar/${encodeURIComponent(request.targetId)}`} className="text-xs underline" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('marketingApprovals.detail.openCampaign')}
                </Link>
              </span>
            </Row>
          )}
        </dl>

        <Block title={t('marketingApprovals.detail.audience')}>
          <dl>
            <Row label={t('marketingApprovals.detail.audienceTotal')}>{fmt.number(s.audience.total)}</Row>
            {Object.entries(s.audience.reachable).map(([channel, n]) => (
              <Row key={channel} label={`${t('marketingApprovals.detail.reachable')}: ${t(`messaging.channel.${channel}`)}`}>
                {fmt.number(n ?? 0)}
              </Row>
            ))}
          </dl>
        </Block>

        <Block title={t('marketingApprovals.detail.regions')}>
          <ul className="flex flex-wrap gap-2">
            {regions.map(([region, n]) => (
              <li key={region}>
                <Badge>{`${t(`marketingApprovals.region.${region}`)}: ${fmt.number(n)}`}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs pt-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('marketingApprovals.detail.countries')}
          </p>
          <ul className="flex flex-wrap gap-2">
            {countries.map(([code, n]) => (
              <li key={code}>
                <Badge tone={s.newCountries.includes(code) ? 'warning' : 'neutral'}>{`${fmt.country(code) ?? t('marketingApprovals.detail.unknownCountry')}: ${fmt.number(n)}`}</Badge>
              </li>
            ))}
          </ul>
          {s.newCountries.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t('marketingApprovals.detail.newCountries')}: {s.newCountries.map((c) => fmt.country(c) ?? c).join(', ')}
            </p>
          )}
          {s.legalBases && Object.keys(s.legalBases).length > 0 && (
            <>
              <p className="text-xs pt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('marketingApprovals.detail.legalBases')}
              </p>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(s.legalBases).map(([basis, n]) => (
                  <li key={basis}>
                    <Badge>{`${t(`crm.card.consent.basis.${basis}`)}: ${fmt.number(n ?? 0)}`}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Block>

        <Block title={t('marketingApprovals.detail.cost')}>
          <dl>
            <Row label={t('marketingApprovals.detail.smsCredits')}>{fmt.number(s.cost.smsCredits)}</Row>
            {messages.map(([channel, n]) => (
              <Row key={channel} label={`${t('marketingApprovals.detail.messages')}: ${t(`messaging.channel.${channel}`)}`}>
                {fmt.number(n)}
              </Row>
            ))}
            {currencies.map(([currency, amount]) => (
              <Row key={currency} label={currency}>
                {fmt.money(currency, amount)}
              </Row>
            ))}
          </dl>
          {currencies.length === 0 && <InlineMessage text={t('marketingApprovals.detail.costNone')} />}
        </Block>

        <Block title={t('marketingApprovals.detail.findings')}>
          {s.findings.length === 0 ? (
            <InlineMessage text={t('marketingApprovals.detail.noFindings')} />
          ) : (
            <ul className="space-y-1">
              {s.findings.map((f, i) => (
                <li key={`${f.code}-${f.channel ?? 'all'}-${i}`} className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                  <Badge tone={f.severity === 'warning' ? 'warning' : 'info'}>{t(`marketingApprovals.severity.${f.severity}`)}</Badge>
                  <span>{t(`marketingApprovals.finding.${f.code}`)}</span>
                  {f.channel && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t(`messaging.channel.${f.channel}`)}</span>}
                  {f.count !== null && f.count > 0 && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{count(f.count)}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {s.emailDomainVerified ? t('marketingApprovals.detail.domainVerified') : s.channels.includes('EMAIL') ? t('marketingApprovals.detail.domainNotVerified') : ''}
          </p>
        </Block>

        <Block title={t('marketingApprovals.detail.reasons')}>
          {s.reasons.length === 0 ? (
            <InlineMessage text={t('marketingApprovals.detail.noReasons')} />
          ) : (
            <ul className="list-disc pl-5 text-sm" style={{ color: 'var(--color-text-primary)' }}>
              {s.reasons.map((r) => (
                <li key={r}>{t(`marketingApprovals.reason.${r}`)}</li>
              ))}
            </ul>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('marketingApprovals.detail.thresholds', {
              email: fmt.number(s.thresholds.selfApproveEmailMax),
              sms: fmt.number(s.thresholds.selfApproveSmsMax),
              credits: fmt.number(s.thresholds.selfApproveSmsCredits),
            })}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('marketingApprovals.detail.evaluatedAt')}: {fmt.date(s.evaluatedAt)}
          </p>
        </Block>

        {(request.canDecide || request.canCancel) && (
          <div className="space-y-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
            <AreaField label={t('marketingApprovals.action.note')} value={note} onChange={setNote} rows={2} hint={request.canDecide ? t('marketingApprovals.action.noteHint') : undefined} />
            <div className="flex flex-wrap gap-2">
              {request.canDecide && (
                <>
                  <PrimaryButton onClick={() => act('approve')} disabled={busy}>
                    {t('marketingApprovals.action.approve')}
                  </PrimaryButton>
                  <SecondaryButton danger onClick={() => act('reject')} disabled={busy || !note.trim()}>
                    {t('marketingApprovals.action.reject')}
                  </SecondaryButton>
                </>
              )}
              {request.canCancel && (
                <SecondaryButton onClick={() => act('cancel')} disabled={busy}>
                  {t('marketingApprovals.action.cancel')}
                </SecondaryButton>
              )}
            </div>
            {!request.canDecide && request.status === 'PENDING' && <InlineMessage text={t('marketingApprovals.action.superAdminOnly')} />}
          </div>
        )}
        {message && <InlineMessage tone={message.tone} text={message.text} />}
      </aside>
    </div>
  );
}
