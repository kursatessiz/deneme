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
import { Select } from '@/components/ui/Select';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { AnchorButton } from '@/components/ui/LinkButton';
import { Card } from '@/components/ui/Card';

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
    <Card as="section" className="grid gap-3 p-4">
      <div>
        <h3 className="ui-heading">{t('accounting.card.title')}</h3>
        <p className="ui-caption mt-0.5">{t('accounting.card.description')}</p>
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
        <FieldGroup label={t('accounting.card.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AccountingKind)}>
            {ACCOUNTING_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`accounting.card.kind.${k}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <FieldGroup label={t('accounting.card.format')}>
          <Select value={format} onChange={(e) => setFormat(e.target.value as AccountingFormat)}>
            {ACCOUNTING_FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(`accounting.card.format.${f}`)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        {format === 'csv' && (
          <FieldGroup label={t('accounting.card.delimiter')}>
            <Select value={delimiter} onChange={(e) => setDelimiter(e.target.value as AccountingDelimiterName)}>
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {t(`accounting.card.delimiter.${d}`)}
                </option>
              ))}
            </Select>
          </FieldGroup>
        )}
        <AnchorButton href={href} download size="sm">
          {t('accounting.card.download')}
        </AnchorButton>
      </div>
      <p className="ui-caption">{t('accounting.card.hint')}</p>
    </Card>
  );
}
