'use client';

import { useState } from 'react';
import { SMS_REGISTRATION_STATUSES, type HubSmsSenderProviderDTO, type IntegrationHubDTO, type MessageKey, type SmsRegistrationStatus } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { PrimaryButton, Section } from '@/components/settings/ui';
import { HubTable } from './HubTable';

const STATUS_TONE: Record<SmsRegistrationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  NOT_STARTED: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const fieldStyle = {
  borderColor: 'var(--color-border)',
  borderRadius: 'var(--radius-input)',
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
} as const;

function StatusSelect({ value, onChange, label }: { value: SmsRegistrationStatus; onChange: (v: SmsRegistrationStatus) => void; label: string }) {
  const t = useT();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as SmsRegistrationStatus)} aria-label={label} className="px-3 py-1.5 text-sm border" style={fieldStyle}>
      {SMS_REGISTRATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`smsSender.status.${s}` as MessageKey)}
        </option>
      ))}
    </select>
  );
}

function ProviderRow({ row, onSave, fmtDate }: { row: HubSmsSenderProviderDTO; onSave: (senderId: string | null, status: SmsRegistrationStatus) => void; fmtDate: (iso: string | null) => string }) {
  const t = useT();
  const [senderId, setSenderId] = useState(row.senderId ?? '');
  const [status, setStatus] = useState<SmsRegistrationStatus>(row.status);
  const valid = senderId.trim() === '' || /^[A-Za-z][A-Za-z0-9 ]{2,10}$/.test(senderId.trim());
  return (
    <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
      <td className="py-2 pr-3">
        <span className="font-medium">{row.provider}</span> {row.active && <Badge tone="info">{t('smsSender.active')}</Badge>}
      </td>
      <td className="py-2 pr-3">
        <input
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          aria-label={t('smsSender.senderId')}
          title={t('smsSender.senderIdHelp')}
          className="px-3 py-1.5 text-sm border font-mono w-40"
          style={{ ...fieldStyle, borderColor: valid ? 'var(--color-border)' : 'var(--color-danger)' }}
        />
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{t(`smsSender.status.${status}` as MessageKey)}</Badge>
          <StatusSelect value={status} onChange={setStatus} label={t('smsSender.status')} />
        </div>
      </td>
      <td className="py-2 pr-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {row.updatedAt ? t('smsSender.updatedAt', { date: fmtDate(row.updatedAt) }) : ''}
      </td>
      <td className="py-2 text-right">
        <PrimaryButton disabled={!valid} onClick={() => onSave(senderId.trim() || null, status)}>
          {t('smsSender.save')}
        </PrimaryButton>
      </td>
    </tr>
  );
}

/**
 * SMS sender identity (M4c): alphanumeric sender id registration status per
 * provider and the Twilio 10DLC brand and campaign status. Entered by hand;
 * only the platform tenant's messaging settings are written.
 */
export function SmsSenderSection({
  data,
  run,
  call,
  fmtDate,
}: {
  data: IntegrationHubDTO;
  run: (action: () => Promise<unknown>) => Promise<void>;
  call: (path: string, method: string, body?: unknown) => Promise<unknown>;
  fmtDate: (iso: string | null) => string;
}) {
  const t = useT();
  const { smsSender } = data;
  const [brand, setBrand] = useState<SmsRegistrationStatus>(smsSender.twilio10dlc?.brandStatus ?? 'NOT_STARTED');
  const [campaign, setCampaign] = useState<SmsRegistrationStatus>(smsSender.twilio10dlc?.campaignStatus ?? 'NOT_STARTED');
  return (
    <Section title={t('smsSender.title')} description={t('smsSender.description')}>
      <HubTable head={[t('smsSender.provider'), t('smsSender.senderId'), t('smsSender.status'), '', '']}>
        {smsSender.providers.map((row) => (
          <ProviderRow
            key={`${row.provider}-${row.updatedAt ?? ''}`}
            row={row}
            fmtDate={fmtDate}
            onSave={(senderId, status) => run(() => call('sms-sender', 'PUT', { kind: 'SENDER_ID', provider: row.provider, senderId, status }))}
          />
        ))}
      </HubTable>
      <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
        <h4 className="text-sm font-medium">{t('smsSender.tenDlc.title')}</h4>
        {!smsSender.twilio10dlc && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('smsSender.tenDlc.notEntered')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs flex items-center gap-2">
            {t('smsSender.tenDlc.brand')}
            <StatusSelect value={brand} onChange={setBrand} label={t('smsSender.tenDlc.brand')} />
          </label>
          <label className="text-xs flex items-center gap-2">
            {t('smsSender.tenDlc.campaign')}
            <StatusSelect value={campaign} onChange={setCampaign} label={t('smsSender.tenDlc.campaign')} />
          </label>
          <PrimaryButton onClick={() => run(() => call('sms-sender', 'PUT', { kind: 'TWILIO_10DLC', brandStatus: brand, campaignStatus: campaign }))}>{t('smsSender.save')}</PrimaryButton>
          {smsSender.twilio10dlc?.updatedAt && (
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('smsSender.updatedAt', { date: fmtDate(smsSender.twilio10dlc.updatedAt) })}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}
