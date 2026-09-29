'use client';

import { useState } from 'react';
import {
  GENERATABLE_DRAFT_KINDS,
  MAX_GENERATIONS_PER_REQUEST,
  MAX_VARIANTS,
  type BrandKitDTO,
  type GenerateDraftsResultDTO,
  type GeneratableDraftKind,
} from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { InlineMessage, PrimaryButton, Section } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { AreaField, CheckField, InputField, SelectField } from '../fields';

/** Brief -> per-channel drafts with N variants (docs/PAZARLAMA_MODULU.md 4.3, item 1 and 2). */
export function GenerateForm({
  kit,
  disabled,
  onGenerated,
}: {
  kit: BrandKitDTO;
  disabled: boolean;
  onGenerated: (result: GenerateDraftsResultDTO) => void;
}) {
  const t = useT();
  const [goal, setGoal] = useState('');
  const [offer, setOffer] = useState('');
  const [sector, setSector] = useState('');
  const [notes, setNotes] = useState('');
  const [icpKey, setIcpKey] = useState('');
  const [locales, setLocales] = useState<string[]>([kit.defaultLocale]);
  const [kinds, setKinds] = useState<GeneratableDraftKind[]>(['EMAIL', 'SMS']);
  const [variantCount, setVariantCount] = useState('3');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const total = locales.length * kinds.length;
  const tooMany = total > MAX_GENERATIONS_PER_REQUEST;

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await bffFetch<GenerateDraftsResultDTO>('platform/marketing/studio/generate', {
        method: 'POST',
        body: {
          brief: {
            goal: goal.trim(),
            ...(offer.trim() ? { offer: offer.trim() } : {}),
            ...(sector.trim() ? { sector: sector.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(icpKey ? { icpKey } : {}),
          },
          locales,
          kinds,
          variantCount: Number(variantCount),
        },
      });
      onGenerated(result);
      setMessage({ text: t('marketingStudio.generate.done', { count: result.drafts.length }), ok: true });
    } catch (err) {
      setMessage({ text: marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('marketingStudio.generate.title')} description={t('marketingStudio.generate.hint')}>
      <AreaField label={t('marketingStudio.generate.goal')} value={goal} onChange={setGoal} rows={3} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <InputField label={t('marketingStudio.generate.offer')} value={offer} onChange={setOffer} />
        <InputField label={t('marketingStudio.generate.sector')} value={sector} onChange={setSector} />
        <SelectField
          label={t('marketingStudio.generate.icp')}
          value={icpKey}
          onChange={setIcpKey}
          options={[{ value: '', label: t('marketingStudio.generate.icpNone') }, ...kit.icps.map((i) => ({ value: i.key, label: i.name }))]}
        />
      </div>
      <AreaField label={t('marketingStudio.generate.notes')} value={notes} onChange={setNotes} rows={2} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {t('marketingStudio.generate.piiNote')}
      </p>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('marketingStudio.generate.locales')}
        </legend>
        <div className="flex flex-wrap gap-4">
          {kit.locales.map((l) => (
            <CheckField
              key={l.locale}
              label={l.locale}
              checked={locales.includes(l.locale)}
              onChange={(on) => setLocales(on ? [...locales, l.locale] : locales.filter((x) => x !== l.locale))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('marketingStudio.generate.kinds')}
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {GENERATABLE_DRAFT_KINDS.map((kind) => (
            <CheckField
              key={kind}
              label={t(`marketingStudio.kind.${kind}`)}
              checked={kinds.includes(kind)}
              onChange={(on) => setKinds(on ? [...kinds, kind] : kinds.filter((x) => x !== kind))}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <SelectField
            label={t('marketingStudio.generate.variants')}
            value={variantCount}
            onChange={setVariantCount}
            options={Array.from({ length: MAX_VARIANTS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          />
        </div>
        <PrimaryButton onClick={submit} disabled={disabled || busy || goal.trim() === '' || locales.length === 0 || kinds.length === 0 || tooMany}>
          {busy ? t('marketingStudio.generate.busy') : t('marketingStudio.generate.button')}
        </PrimaryButton>
      </div>
      {tooMany && <InlineMessage text={t('marketingStudio.generate.tooMany', { max: MAX_GENERATIONS_PER_REQUEST })} tone="error" />}
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
    </Section>
  );
}
