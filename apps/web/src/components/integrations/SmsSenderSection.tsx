'use client';

import { useState } from 'react';
import { SMS_REGISTRATION_STATUSES, type HubSmsSenderProviderDTO, type IntegrationHubDTO, type MessageKey, type SmsRegistrationStatus } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { PrimaryButton, Section } from '@/components/settings/ui';
import { HubTable } from './HubTable';
import { Input, Select, Tr, Td } from '@/components/ui';

const STATUS_TONE: Record<SmsRegistrationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  NOT_STARTED: 'neutral',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

function StatusSelect({ value, onChange, label }: { value: SmsRegistrationStatus; onChange: (v: SmsRegistrationStatus) => void; label: string }) {
  const t = useT();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as SmsRegistrationStatus)} aria-label={label}>
      {SMS_REGISTRATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`smsSender.status.${s}` as MessageKey)}
        </option>
      ))}
    </Select>
  );
}

function ProviderRow({ row, onSave, fmtDate }: { row: HubSmsSenderProviderDTO; onSave: (senderId: string | null, status: SmsRegistrationStatus) => void; fmtDate: (iso: string | null) => string }) {
  const t = useT();
  const [senderId, setSenderId] = useState(row.senderId ?? '');
  const [status, setStatus] = useState<SmsRegistrationStatus>(row.status);
  const valid = senderId.trim() === '' || /^[A-Za-z][A-Za-z0-9 ]{2,10}$/.test(senderId.trim());
  return (
    <Tr>
      <Td>
        <span className="ui-strong">{row.provider}</span> {row.active && <Badge tone="info">{t('smsSender.active')}</Badge>}
      </Td>
      <Td>
        <Input
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          aria-label={t('smsSender.senderId')}
          title={t('smsSender.senderIdHelp')}
          invalid={!valid}
          className="font-mono w-40"
        />
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{t(`smsSender.status.${status}` as MessageKey)}</Badge>
          <StatusSelect value={status} onChange={setStatus} label={t('smsSender.status')} />
        </div>
      </Td>
      <Td className="ui-caption">
        {row.updatedAt ? t('smsSender.updatedAt', { date: fmtDate(row.updatedAt) }) : ''}
      </Td>
      <Td className="text-right">
        <PrimaryButton disabled={!valid} onClick={() => onSave(senderId.trim() || null, status)}>
          {t('smsSender.save')}
        </PrimaryButton>
      </Td>
    </Tr>
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
      <div className="pt-3 space-y-2 ui-rule">
        <h4 className="ui-strong">{t('smsSender.tenDlc.title')}</h4>
        {!smsSender.twilio10dlc && (
          <p className="ui-caption">
            {t('smsSender.tenDlc.notEntered')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 ui-small">
            {t('smsSender.tenDlc.brand')}
            <StatusSelect value={brand} onChange={setBrand} label={t('smsSender.tenDlc.brand')} />
          </label>
          <label className="flex items-center gap-2 ui-small">
            {t('smsSender.tenDlc.campaign')}
            <StatusSelect value={campaign} onChange={setCampaign} label={t('smsSender.tenDlc.campaign')} />
          </label>
          <PrimaryButton onClick={() => run(() => call('sms-sender', 'PUT', { kind: 'TWILIO_10DLC', brandStatus: brand, campaignStatus: campaign }))}>{t('smsSender.save')}</PrimaryButton>
          {smsSender.twilio10dlc?.updatedAt && (
            <span className="ui-caption">
              {t('smsSender.updatedAt', { date: fmtDate(smsSender.twilio10dlc.updatedAt) })}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}
