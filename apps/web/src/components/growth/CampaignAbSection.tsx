'use client';

import { CAMPAIGN_AB_METRICS, CAMPAIGN_MAX_VARIANTS, CAMPAIGN_SEND_TIME_MODES, CAMPAIGN_VARIANT_KEYS, LOCAL_TIME_PATTERN, variantRate } from '@platform/shared';
import type { CampaignAbMetric, CampaignDTO, CampaignSendTimeMode, CampaignVariantInput } from '@platform/shared';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge } from '@/components/common/Badge';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Field, Muted, inputClass, inputStyle, useDateFormat } from './ui';

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
      <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {t('campaigns.sendTime.title')}
      </legend>
      <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: 'var(--color-text-primary)' }}>
        {CAMPAIGN_SEND_TIME_MODES.map((mode) => (
          <label key={mode} className="inline-flex items-center gap-2">
            <input type="radio" name="campaign-send-time-mode" checked={form.mode === mode} disabled={disabled} onChange={() => onChange({ ...form, mode })} />
            {t(`campaigns.sendTime.mode.${mode}`)}
          </label>
        ))}
      </div>
      {form.mode !== 'FIXED' && (
        <div className="max-w-xs">
          <Field
            label={t(form.mode === 'BEST_TIME' ? 'campaigns.sendTime.fallbackTime' : 'campaigns.sendTime.localTime')}
            htmlFor="campaign-send-time-local"
            hint={form.mode === 'BEST_TIME' ? t('campaigns.sendTime.fallbackHint') : undefined}
          >
            <input
              id="campaign-send-time-local"
              type="time"
              value={form.local}
              disabled={disabled}
              onChange={(e) => onChange({ ...form, local: e.target.value })}
              className={inputClass}
              style={inputStyle}
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
    <fieldset className="md:col-span-2 space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
      <legend className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('campaigns.ab.title')}
      </legend>
      <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
        <input type="checkbox" checked={form.enabled} disabled={disabled} onChange={(e) => onChange({ ...form, enabled: e.target.checked })} />
        {t('campaigns.ab.enable')}
      </label>
      {disabled && form.enabled && <Muted>{t('campaigns.ab.locked')}</Muted>}
      {form.enabled && (
        <>
          <Muted>{t('campaigns.ab.hint')}</Muted>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={t('campaigns.ab.share')} htmlFor="campaign-ab-share">
              <input
                id="campaign-ab-share"
                type="number"
                min={5}
                max={50}
                value={form.testShare}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, testShare: e.target.value })}
                className={inputClass}
                style={inputStyle}
              />
            </Field>
            <Field label={t('campaigns.ab.metric')} htmlFor="campaign-ab-metric" hint={t(`campaigns.ab.metricHint.${form.metric}`)}>
              <select
                id="campaign-ab-metric"
                value={form.metric}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, metric: e.target.value as CampaignAbMetric })}
                className={inputClass}
                style={inputStyle}
              >
                {CAMPAIGN_AB_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`campaigns.ab.metric.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('campaigns.ab.wait')} htmlFor="campaign-ab-wait" hint={t('campaigns.ab.waitHint')}>
              <input
                id="campaign-ab-wait"
                type="number"
                min={1}
                value={form.waitMinutes}
                disabled={disabled}
                onChange={(e) => onChange({ ...form, waitMinutes: e.target.value })}
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>

          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('campaigns.ab.variants')}
          </p>
          <Muted>{t('campaigns.ab.overridesHint')}</Muted>
          <ul className="space-y-3">
            {form.variants.map((v, index) => (
              <li key={v.key} className="space-y-2 border-l-2 pl-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {t('campaigns.ab.variantLabel', { key: v.key })}
                    {v.aiDraftId && <Badge tone="info">{t('campaigns.ab.aiDraft')}</Badge>}
                  </span>
                  {!disabled && form.variants.length > 2 && (
                    <button
                      type="button"
                      className="text-xs underline"
                      style={{ color: 'var(--color-text-secondary)' }}
                      onClick={() => onChange({ ...form, variants: form.variants.filter((_, i) => i !== index) })}
                    >
                      {t('campaigns.ab.removeVariant')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label={t('campaigns.ab.templateKey')} htmlFor={`campaign-ab-template-${v.key}`}>
                    {templateKeys ? (
                      <select
                        id={`campaign-ab-template-${v.key}`}
                        value={v.templateKey}
                        disabled={disabled}
                        onChange={(e) => setVariant(index, { templateKey: e.target.value })}
                        className={inputClass}
                        style={inputStyle}
                      >
                        <option value="">{t('campaigns.ab.templateDefault')}</option>
                        {templateKeys.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`campaign-ab-template-${v.key}`}
                        value={v.templateKey}
                        disabled={disabled}
                        onChange={(e) => setVariant(index, { templateKey: e.target.value.toUpperCase() })}
                        className={inputClass}
                        style={inputStyle}
                      />
                    )}
                  </Field>
                  <Field label={t('campaigns.ab.subject')} htmlFor={`campaign-ab-subject-${v.key}`}>
                    <input
                      id={`campaign-ab-subject-${v.key}`}
                      value={v.subject}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) => setVariant(index, { subject: e.target.value })}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label={t('campaigns.ab.preheader')} htmlFor={`campaign-ab-preheader-${v.key}`}>
                    <input
                      id={`campaign-ab-preheader-${v.key}`}
                      value={v.preheader}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) => setVariant(index, { preheader: e.target.value })}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </Field>
                </div>
                <Field label={t('campaigns.ab.body')} htmlFor={`campaign-ab-body-${v.key}`}>
                  <textarea
                    id={`campaign-ab-body-${v.key}`}
                    value={v.body}
                    rows={3}
                    maxLength={10000}
                    disabled={disabled}
                    onChange={(e) => setVariant(index, { body: e.target.value })}
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
              </li>
            ))}
          </ul>
          {!disabled && form.variants.length < CAMPAIGN_MAX_VARIANTS && nextKey && (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => onChange({ ...form, variants: [...form.variants, emptyVariant(nextKey)] })}
            >
              {t('campaigns.ab.addVariant')}
            </button>
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.variant')}</th>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.sent')}</th>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.opened')}</th>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.clicked')}</th>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.converted')}</th>
              <th className="py-1 pr-3 font-medium">{t('campaigns.ab.col.rate')}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody style={{ color: 'var(--color-text-primary)' }}>
            {campaign.variants.map((v) => (
              <tr key={v.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    {t('campaigns.ab.variantLabel', { key: v.key })}
                    {v.isWinner && <Badge tone="success">{t('campaigns.ab.winner')}</Badge>}
                  </span>
                </td>
                <td className="py-1.5 pr-3">{v.stats ? fmt.number(v.stats.sent) : ''}</td>
                <td className="py-1.5 pr-3">{v.stats ? fmt.number(v.stats.opened) : ''}</td>
                <td className="py-1.5 pr-3">{v.stats ? fmt.number(v.stats.clicked) : ''}</td>
                <td className="py-1.5 pr-3">{v.stats ? fmt.number(v.stats.converted) : ''}</td>
                <td className="py-1.5 pr-3">{v.stats ? percent.format(variantRate(v.stats, metric)) : ''}</td>
                <td className="py-1.5 text-right">
                  {canPick && (
                    <PermissionButton required={['campaigns.manage']} onClick={() => onPick(v.key)} disabled={busy}>
                      {t('campaigns.ab.pickThis')}
                    </PermissionButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
