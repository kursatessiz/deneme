'use client';

import { useState } from 'react';
import { ACCOUNTING_FORMATS, ACCOUNTING_KINDS } from '@platform/shared';
import type { AccountingDelimiterName, AccountingFormat, AccountingKind } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { resolveDateRangePreset } from '@/lib/date-range';
import { hasAnyPermission } from '@/lib/nav';

const fieldStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

const DELIMITERS: readonly AccountingDelimiterName[] = ['semicolon', 'comma'];

/** The picked end date is a calendar day: the export runs to the end of it. */
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Accounting export (G3c-3, docs/MUHASEBE.md): builds the download URL of
 * `GET studios/:studioId/accounting/export` through the BFF, so the browser
 * saves the file with the session cookie and no token in the address bar.
 */
export function AccountingExportCard() {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const initial = resolveDateRangePreset('last_30_days');
  const [from, setFrom] = useState<Date | null>(initial.from);
  const [to, setTo] = useState<Date | null>(initial.to);
  const [branchId, setBranchId] = useState('');
  const [kind, setKind] = useState<AccountingKind>('sales');
  // XLSX is the default; the delimiter option only applies to CSV.
  const [format, setFormat] = useState<AccountingFormat>('xlsx');
  const [delimiter, setDelimiter] = useState<AccountingDelimiterName>('semicolon');

  if (!hasAnyPermission(['accounting.export'], permissions, isOwner) || !activeStudioId) return null;

  const params = new URLSearchParams({ kind, format, locale });
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', endOfDay(to).toISOString());
  if (branchId) params.set('branchId', branchId);
  if (format === 'csv') params.set('delimiter', delimiter);
  const href = `/api/bff/studios/${activeStudioId}/accounting/export?${params.toString()}`;

  return (
    <section className="p-4 space-y-3" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--color-surface)' }}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('accounting.card.title')}
        </h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('accounting.card.description')}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(range) => {
            setFrom(range.from);
            setTo(range.to);
          }}
        />
        <BranchSelect value={branchId} onChange={setBranchId} />
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('accounting.card.kind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountingKind)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            {ACCOUNTING_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`accounting.card.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="block">{t('accounting.card.format')}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as AccountingFormat)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
            {ACCOUNTING_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`accounting.card.format.${f}`)}
              </option>
            ))}
          </select>
        </label>
        {format === 'csv' && (
          <label className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="block">{t('accounting.card.delimiter')}</span>
            <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as AccountingDelimiterName)} className="text-xs px-2.5 py-1.5" style={fieldStyle}>
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {t(`accounting.card.delimiter.${d}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <a
          href={href}
          download
          className="text-xs font-medium px-3 py-1.5 hover:opacity-90"
          style={{ borderRadius: 'var(--radius-button)', background: 'var(--gradient-brand)', color: 'var(--color-on-primary)' }}
        >
          {t('accounting.card.download')}
        </a>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        {t('accounting.card.hint')}
      </p>
    </section>
  );
}
