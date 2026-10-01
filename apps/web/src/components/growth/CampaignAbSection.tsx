'use client';

import { CAMPAIGN_AB_METRICS, CAMPAIGN_MAX_VARIANTS, CAMPAIGN_SEND_TIME_MODES, CAMPAIGN_VARIANT_KEYS, LOCAL_TIME_PATTERN, variantRate } from '@platform/shared';
import type { CampaignAbMetric, CampaignDTO, CampaignSendTimeMode, CampaignVariantInput } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Field, Muted, useDateFormat } from './ui';
import { Input, Select, Textarea, Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Radio } from '@/components/ui/Radio';

/** One variant as the editor holds it (strings, so an empty field can mean "use the campaign's own"). */
export interface VariantForm {
  key: string;
  templateKey: string;
  subject: string;
  preheader: string;
  body: string;
  aiDraftId: string | null;
}

export interface AbForm {
  enabled: boolean;
  testShare: string;
  metric: CampaignAbMetric;
  waitMinutes: string;
  variants: VariantForm[];
}

export interface SendTimeForm {
  mode: CampaignSendTimeMode;
  local: string;
}

const emptyVariant = (key: string): VariantForm => ({ key, templateKey: '', subject: '', preheader: '', body: '', aiDraftId: null });

export function emptyAbForm(): AbForm {
  return { enabled: false, testShare: '20', metric: 'CLICK_RATE', waitMinutes: '1440', variants: [emptyVariant('A'), emptyVariant('B')] };
}

export function abFormFromCampaign(c: CampaignDTO): AbForm {
  if (!c.abTest || c.variants.length === 0) return emptyAbForm();
  return {
    enabled: true,
    testShare: String(c.abTest.testShare),
    metric: c.abTest.metric,
    waitMinutes: String(c.abTest.waitMinutes),
    variants: c.variants.map((v) => ({
      key: v.key,
      templateKey: v.templateKey ?? '',
      subject: v.overrides?.subject ?? '',
      preheader: v.overrides?.preheader ?? '',
      body: v.overrides?.body ?? '',
      aiDraftId: v.aiDraftId,
    })),
  };
}

export function variantsToPayload(variants: VariantForm[]): CampaignVariantInput[] {
  return variants.map((v) => {
    const overrides = {
      ...(v.subject.trim() ? { subject: v.subject.trim() } : {}),
      ...(v.preheader.trim() ? { preheader: v.preheader.trim() } : {}),
      ...(v.body.trim() ? { body: v.body.trim() } : {}),
    };
    return {
      key: v.key as CampaignVariantInput['key'],
      templateKey: v.templateKey.trim() || null,
      overrides: Object.keys(overrides).length > 0 ? overrides : null,
      aiDraftId: v.aiDraftId,
    };
  });
}

export function abPayload(form: AbForm) {
  return form.enabled
    ? { abTest: { testShare: Number(form.testShare), metric: form.metric, waitMinutes: Number(form.waitMinutes) }, variants: variantsToPayload(form.variants) }
    : { abTest: null };
}

export function sendTimePayload(form: SendTimeForm) {
  return { sendTimeMode: form.mode, sendTimeLocal: form.mode === 'FIXED' ? null : form.local || null };
}

/** Translation key of the first thing wrong with the A/B and send time inputs, or null when they can be saved. */
export function abSendTimeError(ab: AbForm, sendTime: SendTimeForm): string | null {
  if (sendTime.mode === 'RECIPIENT_LOCAL' && !LOCAL_TIME_PATTERN.test(sendTime.local)) return 'campaigns.sendTime.localRequired';
  if (sendTime.mode === 'BEST_TIME' && sendTime.local !== '' && !LOCAL_TIME_PATTERN.test(sendTime.local)) return 'campaigns.sendTime.localRequired';
  if (ab.enabled && ab.variants.length < 2) return 'campaigns.ab.minVariants';
  return null;
}

/** Send time selector: fixed (the schedule above), recipient local time, or each person's best time. */
export function SendTimeEditor({ form, onChange, disabled }: { form: SendTimeForm; onChange: (next: SendTimeForm) => void; disabled: boolean }) {
  const t = useT();
  return (
    <fieldset className="md:col-span-2 space-y-2">
      <legend className="ui-strong ui-caption">
        {t('campaigns.sendTime.title')}
      </legend>
      <div className="flex flex-wrap items-center gap-4">
        {CAMPAIGN_SEND_TIME_MODES.map((mode) => (
          <Radio key={mode} name="campaign-send-time-mode" checked={form.mode === mode} disabled={disabled} onChange={() => onChange({ ...form, mode })} label={t(`campaigns.sendTime.mode.${mode}`)} />
        ))}
      </div>
      {form.mode !== 'FIXED' && (
        <div className="max-w-xs">
          <Field
            label={t(form.mode === 'BEST_TIME' ? 'campaigns.sendTime.fallbackTime' : 'campaigns.sendTime.localTime')}
            htmlFor="campaign-send-time-local"
            hint={form.mode === 'BEST_TIME' ? t('campaigns.sendTime.fallbackHint') : undefined}
          >
            <Input
              id="campaign-send-time-local"
              type="time"
              value={form.local}
              disabled={disabled}
              onChange={(e) => onChange({ ...form, local: e.target.value })}
            />
          </Field>
        </div>
      )}
      <Muted>{t(`campaigns.sendTime.hint.${form.mode}`)}</Muted>
    </fieldset>
  );
}

/** A/B test setup: variants (own template and/or subject, preheader and text), test share, metric and wait. */
export function AbTestEditor({
  form,
  onChange,
  disabled,
  templateKeys,
}: {
  form: AbForm;
  onChange: (next: AbForm) => void;
  disabled: boolean;
  templateKeys: string[] | null;
}) {
  const t = useT();
  const setVariant = (index: number, patch: Partial<VariantForm>) =>
    onChange({ ...form, variants: form.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) });
  const nextKey = CAMPAIGN_VARIANT_KEYS.find((k) => !form.variants.some((v) => v.key === k));

  return (
    <fieldset className="md:col-span-2 space-y-3 pt-4 ui-rule">
      <legend className="ui-strong ui-small">
        {t('campaigns.ab.title')}
      </legend>
      <Checkbox checked={form.enabled} disabled={disabled} onChange={(e) => onChange({ ...form, enabled: e.target.checked })} label={t('campaigns.ab.enable')} />
      {disabled && form.enabled && <Muted>{t('campaigns.ab.locked')}</Muted>}
      {form.enabled && (
        <>
          <Muted>{t('campaigns.ab.hint')}</Muted>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={t('campaigns.ab.share')} htmlFor="campaign-ab-share">
              <Input
                id="campaign-ab-share"
                type="number"
                min={5}
                max={50}
                value={form.testShare}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, testShare: e.target.value })}
              />
            </Field>
            <Field label={t('campaigns.ab.metric')} htmlFor="campaign-ab-metric" hint={t(`campaigns.ab.metricHint.${form.metric}`)}>
              <Select
                id="campaign-ab-metric"
                value={form.metric}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, metric: e.target.value as CampaignAbMetric })}
              >
                {CAMPAIGN_AB_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`campaigns.ab.metric.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('campaigns.ab.wait')} htmlFor="campaign-ab-wait" hint={t('campaigns.ab.waitHint')}>
              <Input
                id="campaign-ab-wait"
                type="number"
                min={1}
                value={form.waitMinutes}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, waitMinutes: e.target.value })}
              />
            </Field>
          </div>

          <p className="ui-strong ui-caption">
            {t('campaigns.ab.variants')}
          </p>
          <Muted>{t('campaigns.ab.overridesHint')}</Muted>
          <ul className="space-y-3">
            {form.variants.map((v, index) => (
              <li key={v.key} className="space-y-2 ui-rail">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 ui-strong">
                    {t('campaigns.ab.variantLabel', { key: v.key })}
                    {v.aiDraftId && <Badge tone="info">{t('campaigns.ab.aiDraft')}</Badge>}
                  </span>
                  {!disabled && form.variants.length > 2 && (
                    <Button variant="link" tone="muted" size="sm"
                      type="button"
                      onClick={() => onChange({ ...form, variants: form.variants.filter((_, i) => i !== index) })}
                    >
                      {t('campaigns.ab.removeVariant')}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label={t('campaigns.ab.templateKey')} htmlFor={`campaign-ab-template-${v.key}`}>
                    {templateKeys ? (
                      <Select
                        id={`campaign-ab-template-${v.key}`}
                        value={v.templateKey}
                        disabled={disabled}
                        onChange={(e) => setVariant(index, { templateKey: e.target.value })}
                      >
                        <option value="">{t('campaigns.ab.templateDefault')}</option>
                        {templateKeys.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`campaign-ab-template-${v.key}`}
                        value={v.templateKey}
                        disabled={disabled}
                        onChange={(e) => setVariant(index, { templateKey: e.target.value.toUpperCase() })}
                      />
                    )}
                  </Field>
                  <Field label={t('campaigns.ab.subject')} htmlFor={`campaign-ab-subject-${v.key}`}>
                    <Input
                      id={`campaign-ab-subject-${v.key}`}
                      value={v.subject}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) => setVariant(index, { subject: e.target.value })}
                    />
                  </Field>
                  <Field label={t('campaigns.ab.preheader')} htmlFor={`campaign-ab-preheader-${v.key}`}>
                    <Input
                      id={`campaign-ab-preheader-${v.key}`}
                      value={v.preheader}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) => setVariant(index, { preheader: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t('campaigns.ab.body')} htmlFor={`campaign-ab-body-${v.key}`}>
                  <Textarea
                    id={`campaign-ab-body-${v.key}`}
                    value={v.body}
                    rows={3}
                    maxLength={10000}
                    disabled={disabled}
                    onChange={(e) => setVariant(index, { body: e.target.value })}
                  />
                </Field>
              </li>
            ))}
          </ul>
          {!disabled && form.variants.length < CAMPAIGN_MAX_VARIANTS && nextKey && (
            <Button variant="link" tone="muted" size="sm"
              type="button"
              onClick={() => onChange({ ...form, variants: [...form.variants, emptyVariant(nextKey)] })}
            >
              {t('campaigns.ab.addVariant')}
            </Button>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Variant results of a campaign that has started: phase, per-variant numbers, the winner and "pick the winner now". */
export function VariantResults({
  campaign,
  busy,
  onPick,
}: {
  campaign: CampaignDTO;
  busy: boolean;
  onPick: (variantKey?: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const fmt = useDateFormat();
  if (!campaign.abTest || campaign.variants.length === 0) return null;
  const metric = campaign.abTest.metric;
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const canPick = campaign.status === 'SENDING' && campaign.winnerKey === null && (campaign.abPhase === 'TEST' || campaign.abPhase === 'WAITING');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {campaign.abPhase && <Badge tone={campaign.abPhase === 'DECIDED' ? 'success' : 'info'}>{t(`campaigns.ab.phase.${campaign.abPhase}`)}</Badge>}
        <Muted>{t(`campaigns.ab.metric.${metric}`)}</Muted>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>{t('campaigns.ab.col.variant')}</Th>
              <Th>{t('campaigns.ab.col.sent')}</Th>
              <Th>{t('campaigns.ab.col.opened')}</Th>
              <Th>{t('campaigns.ab.col.clicked')}</Th>
              <Th>{t('campaigns.ab.col.converted')}</Th>
              <Th>{t('campaigns.ab.col.rate')}</Th>
              <Th  />
            </Tr>
          </Thead>
          <Tbody>
            {campaign.variants.map((v) => (
              <Tr key={v.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    {t('campaigns.ab.variantLabel', { key: v.key })}
                    {v.isWinner && <Badge tone="success">{t('campaigns.ab.winner')}</Badge>}
                  </span>
                </Td>
                <Td>{v.stats ? fmt.number(v.stats.sent) : ''}</Td>
                <Td>{v.stats ? fmt.number(v.stats.opened) : ''}</Td>
                <Td>{v.stats ? fmt.number(v.stats.clicked) : ''}</Td>
                <Td>{v.stats ? fmt.number(v.stats.converted) : ''}</Td>
                <Td>{v.stats ? percent.format(variantRate(v.stats, metric)) : ''}</Td>
                <Td className="text-right">
                  {canPick && (
                    <PermissionButton required={['campaigns.manage']} onClick={() => onPick(v.key)} disabled={busy}>
                      {t('campaigns.ab.pickThis')}
                    </PermissionButton>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
      {canPick && (
        <div className="space-y-1">
          <PermissionButton required={['campaigns.manage']} variant="primary" onClick={() => onPick()} disabled={busy}>
            {t('campaigns.ab.pickWinner')}
          </PermissionButton>
          <Muted>{t('campaigns.ab.pickWinnerHint')}</Muted>
        </div>
      )}
    </div>
  );
}
