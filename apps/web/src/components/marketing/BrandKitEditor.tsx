'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BRAND_CHANNELS,
  type BrandChannel,
  type BrandKitViewDTO,
  type ProductFactDTO,
  type ProductFactInput,
  type PublicLanguagesDTO,
  type UpsertBrandKitInput,
} from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { ErrorState, LoadingState } from '@/components/common/DataState';
import { Badge } from '@/components/common/Badge';
import { InlineMessage, PrimaryButton, SecondaryButton, Section, SettingsHeader } from '@/components/settings/ui';
import { marketingErrorText } from '@/lib/marketing/errors';
import { AreaField, CheckField, InputField, LinkButton, SelectField } from './fields';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui';
import { useConfirm } from '@/components/ui';

const LINK_KEYS = ['website', 'linkedin', 'instagram', 'facebook', 'x', 'youtube'] as const;

interface LocaleForm {
  locale: string;
  toneNotes: string;
  doList: string;
  dontList: string;
  bannedPhrases: string;
  disclaimers: Record<BrandChannel, string>;
}

interface IcpForm {
  key: string;
  name: string;
  description: string;
}

type SenderForm = Record<BrandChannel, { displayName: string; address: string; replyTo: string }>;

interface KitForm {
  brandName: string;
  positioning: string;
  defaultLocale: string;
  links: Record<(typeof LINK_KEYS)[number], string>;
  senders: SenderForm;
  icps: IcpForm[];
  locales: LocaleForm[];
}

interface FactForm {
  id: string | null;
  key: string;
  category: string;
  statements: Record<string, string>;
  sourceUrl: string;
  validUntil: string;
  isActive: boolean;
}

const lines = (value: string): string[] =>
  value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

const emptySenders = (): SenderForm => ({
  EMAIL: { displayName: '', address: '', replyTo: '' },
  SMS: { displayName: '', address: '', replyTo: '' },
  WHATSAPP: { displayName: '', address: '', replyTo: '' },
});

const emptyLocale = (locale: string): LocaleForm => ({
  locale,
  toneNotes: '',
  doList: '',
  dontList: '',
  bannedPhrases: '',
  disclaimers: { EMAIL: '', SMS: '', WHATSAPP: '' },
});

function toForm(view: BrandKitViewDTO, fallbackLocale: string): KitForm {
  const kit = view.kit;
  const senders = emptySenders();
  const links = { website: '', linkedin: '', instagram: '', facebook: '', x: '', youtube: '' };
  if (!kit) {
    return { brandName: '', positioning: '', defaultLocale: fallbackLocale, links, senders, icps: [], locales: [emptyLocale(fallbackLocale)] };
  }
  for (const channel of BRAND_CHANNELS) {
    const s = kit.senderIdentities[channel];
    if (s) senders[channel] = { displayName: s.displayName ?? '', address: s.address ?? '', replyTo: s.replyTo ?? '' };
  }
  for (const key of LINK_KEYS) links[key] = kit.links[key] ?? '';
  return {
    brandName: kit.brandName,
    positioning: kit.positioning,
    defaultLocale: kit.defaultLocale,
    links,
    senders,
    icps: kit.icps.map((i) => ({ key: i.key, name: i.name, description: i.description })),
    locales: kit.locales.map((l) => ({
      locale: l.locale,
      toneNotes: l.toneNotes,
      doList: l.doList.join('\n'),
      dontList: l.dontList.join('\n'),
      bannedPhrases: l.bannedPhrases.join('\n'),
      disclaimers: { EMAIL: l.requiredDisclaimers.EMAIL ?? '', SMS: l.requiredDisclaimers.SMS ?? '', WHATSAPP: l.requiredDisclaimers.WHATSAPP ?? '' },
    })),
  };
}

function toPayload(form: KitForm): UpsertBrandKitInput {
  const links: Record<string, string> = {};
  for (const key of LINK_KEYS) if (form.links[key].trim() !== '') links[key] = form.links[key].trim();
  const senderIdentities: Record<string, Record<string, string>> = {};
  for (const channel of BRAND_CHANNELS) {
    const s = form.senders[channel];
    const entry: Record<string, string> = {};
    if (s.displayName.trim()) entry.displayName = s.displayName.trim();
    if (s.address.trim()) entry.address = s.address.trim();
    if (s.replyTo.trim()) entry.replyTo = s.replyTo.trim();
    if (Object.keys(entry).length > 0) senderIdentities[channel] = entry;
  }
  return {
    brandName: form.brandName.trim(),
    positioning: form.positioning.trim(),
    defaultLocale: form.defaultLocale,
    links,
    senderIdentities,
    icps: form.icps.map((i) => ({ key: i.key.trim(), name: i.name.trim(), description: i.description.trim() })),
    locales: form.locales.map((l) => {
      const requiredDisclaimers: Record<string, string> = {};
      for (const channel of BRAND_CHANNELS) if (l.disclaimers[channel].trim()) requiredDisclaimers[channel] = l.disclaimers[channel].trim();
      return {
        locale: l.locale,
        toneNotes: l.toneNotes.trim(),
        doList: lines(l.doList),
        dontList: lines(l.dontList),
        bannedPhrases: lines(l.bannedPhrases),
        requiredDisclaimers,
      };
    }),
  } as UpsertBrandKitInput;
}

const emptyFact = (locales: string[]): FactForm => ({
  id: null,
  key: '',
  category: 'general',
  statements: Object.fromEntries(locales.map((l) => [l, ''])),
  sourceUrl: '',
  validUntil: '',
  isActive: true,
});

/**
 * Brand kit and product facts of the platform tenant (/pazarlama/marka,
 * docs/PAZARLAMA_MODULU.md 4.2). One kit, saved as a whole; product facts
 * are separate short claims the AI studio may state. Read-only for viewers
 * (the API answers canEdit).
 */
export function BrandKitEditor() {
  const t = useT();
  const { confirm } = useConfirm();
  const uiLocale = useLocale();
  const [view, setView] = useState<BrandKitViewDTO | null>(null);
  const [form, setForm] = useState<KitForm | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLocale, setNewLocale] = useState('');
  const [fact, setFact] = useState<FactForm | null>(null);
  const [factMessage, setFactMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    bffFetch<BrandKitViewDTO>('platform/marketing/brand-kit')
      .then((res) => {
        setView(res);
        setForm(toForm(res, uiLocale));
        setError(null);
      })
      .catch((err) => setError(err instanceof BffError ? err.message : t('brandKit.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLocale]);

  useEffect(load, [load]);
  useEffect(() => {
    bffFetch<PublicLanguagesDTO>('i18n/languages')
      .then((res) => setLanguages(res.items.map((l) => l.code)))
      .catch(() => setLanguages([]));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!view || !form) return <LoadingState />;
  const canEdit = view.canEdit;
  const kitLocales = form.locales.map((l) => l.locale);
  const update = (patch: Partial<KitForm>) => setForm({ ...form, ...patch });
  const updateLocale = (index: number, patch: Partial<LocaleForm>) =>
    update({ locales: form.locales.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await bffFetch<BrandKitViewDTO>('platform/marketing/brand-kit', { method: 'PUT', body: toPayload(form) });
      setView(res);
      setForm(toForm(res, uiLocale));
      setMessage({ text: t('brandKit.saved'), ok: true });
    } catch (err) {
      setMessage({ text: err instanceof BffError && err.status === 400 ? t('brandKit.invalid') : marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveFact() {
    if (!fact) return;
    setBusy(true);
    setFactMessage(null);
    const statements: Record<string, string> = {};
    for (const [locale, text] of Object.entries(fact.statements)) if (text.trim()) statements[locale] = text.trim();
    const body: ProductFactInput = {
      key: fact.key.trim(),
      category: fact.category.trim() || 'general',
      statements,
      sourceUrl: fact.sourceUrl.trim() || null,
      validUntil: fact.validUntil || null,
      isActive: fact.isActive,
    };
    try {
      if (fact.id) await bffFetch(`platform/marketing/brand-kit/facts/${fact.id}`, { method: 'PATCH', body });
      else await bffFetch('platform/marketing/brand-kit/facts', { method: 'POST', body });
      setFact(null);
      load();
    } catch (err) {
      setFactMessage({ text: err instanceof BffError && err.status === 400 ? t('brandKit.facts.invalid') : marketingErrorText(err, t), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function removeFact(id: string) {
    if (!(await confirm({ message: t('brandKit.facts.confirmDelete'), danger: true }))) return;
    try {
      await bffFetch(`platform/marketing/brand-kit/facts/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setFactMessage({ text: marketingErrorText(err, t), ok: false });
    }
  }

  const editFact = (f: ProductFactDTO) =>
    setFact({
      id: f.id,
      key: f.key,
      category: f.category,
      statements: Object.fromEntries([...new Set([...kitLocales, ...Object.keys(f.statements)])].map((l) => [l, f.statements[l] ?? ''])),
      sourceUrl: f.sourceUrl ?? '',
      validUntil: f.validUntil ?? '',
      isActive: f.isActive,
    });

  const addableLanguages = languages.filter((code) => !kitLocales.includes(code));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <SettingsHeader title={t('brandKit.title')} description={t('brandKit.subtitle')} />
      {!canEdit && <InlineMessage text={t('brandKit.readOnly')} />}
      {view.kit && (
        <p className="ui-caption">
          {t('brandKit.version', { version: view.kit.version })}
          {' - '}
          {t('brandKit.updatedAt', { date: new Intl.DateTimeFormat(uiLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(view.kit.updatedAt)) })}
        </p>
      )}

      <Section title={t('brandKit.identity.title')} description={t('brandKit.identity.hint')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InputField label={t('brandKit.identity.brandName')} value={form.brandName} onChange={(v) => update({ brandName: v })} disabled={!canEdit} />
          <SelectField
            label={t('brandKit.identity.defaultLocale')}
            value={form.defaultLocale}
            onChange={(v) => update({ defaultLocale: v })}
            options={kitLocales.map((l) => ({ value: l, label: l }))}
            disabled={!canEdit}
          />
        </div>
        <AreaField label={t('brandKit.identity.positioning')} value={form.positioning} onChange={(v) => update({ positioning: v })} rows={2} disabled={!canEdit} />
      </Section>

      <Section title={t('brandKit.links.title')} description={t('brandKit.links.hint')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {LINK_KEYS.map((key) => (
            <InputField
              key={key}
              label={t(`brandKit.links.${key}`)}
              value={form.links[key]}
              onChange={(v) => update({ links: { ...form.links, [key]: v } })}
              placeholder="https://"
              disabled={!canEdit}
            />
          ))}
        </div>
      </Section>

      <Section title={t('brandKit.senders.title')} description={t('brandKit.senders.hint')}>
        <div className="space-y-4">
          {BRAND_CHANNELS.map((channel) => (
            <div key={channel} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <InputField
                label={t('brandKit.senders.displayName', { channel: t(`brandKit.channel.${channel}`) })}
                value={form.senders[channel].displayName}
                onChange={(v) => update({ senders: { ...form.senders, [channel]: { ...form.senders[channel], displayName: v } } })}
                disabled={!canEdit}
              />
              <InputField
                label={t(`brandKit.senders.address.${channel}`)}
                value={form.senders[channel].address}
                onChange={(v) => update({ senders: { ...form.senders, [channel]: { ...form.senders[channel], address: v } } })}
                disabled={!canEdit}
              />
              {channel === 'EMAIL' && (
                <InputField
                  label={t('brandKit.senders.replyTo')}
                  value={form.senders.EMAIL.replyTo}
                  onChange={(v) => update({ senders: { ...form.senders, EMAIL: { ...form.senders.EMAIL, replyTo: v } } })}
                  disabled={!canEdit}
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('brandKit.icps.title')} description={t('brandKit.icps.hint')}>
        {form.icps.length === 0 && (
          <p className="ui-text-muted">
            {t('brandKit.icps.empty')}
          </p>
        )}
        {form.icps.map((icp, index) => (
          <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_auto] gap-3 items-end">
            <InputField label={t('brandKit.icps.key')} value={icp.key} onChange={(v) => update({ icps: form.icps.map((x, i) => (i === index ? { ...x, key: v } : x)) })} disabled={!canEdit} />
            <InputField label={t('brandKit.icps.name')} value={icp.name} onChange={(v) => update({ icps: form.icps.map((x, i) => (i === index ? { ...x, name: v } : x)) })} disabled={!canEdit} />
            <InputField
              label={t('brandKit.icps.description')}
              value={icp.description}
              onChange={(v) => update({ icps: form.icps.map((x, i) => (i === index ? { ...x, description: v } : x)) })}
              disabled={!canEdit}
            />
            {canEdit && (
              <LinkButton danger onClick={() => update({ icps: form.icps.filter((_, i) => i !== index) })}>
                {t('brandKit.remove')}
              </LinkButton>
            )}
          </div>
        ))}
        {canEdit && form.icps.length < 10 && (
          <SecondaryButton onClick={() => update({ icps: [...form.icps, { key: '', name: '', description: '' }] })}>{t('brandKit.icps.add')}</SecondaryButton>
        )}
      </Section>

      {form.locales.map((locale, index) => (
        <Section key={locale.locale} title={t('brandKit.locale.title', { locale: locale.locale })} description={t('brandKit.locale.hint')}>
          <AreaField label={t('brandKit.locale.toneNotes')} value={locale.toneNotes} onChange={(v) => updateLocale(index, { toneNotes: v })} disabled={!canEdit} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <AreaField label={t('brandKit.locale.doList')} hint={t('brandKit.locale.onePerLine')} value={locale.doList} onChange={(v) => updateLocale(index, { doList: v })} rows={4} disabled={!canEdit} />
            <AreaField label={t('brandKit.locale.dontList')} hint={t('brandKit.locale.onePerLine')} value={locale.dontList} onChange={(v) => updateLocale(index, { dontList: v })} rows={4} disabled={!canEdit} />
            <AreaField
              label={t('brandKit.locale.bannedPhrases')}
              hint={t('brandKit.locale.onePerLine')}
              value={locale.bannedPhrases}
              onChange={(v) => updateLocale(index, { bannedPhrases: v })}
              rows={4}
              disabled={!canEdit}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {BRAND_CHANNELS.map((channel) => (
              <AreaField
                key={channel}
                label={t('brandKit.locale.disclaimer', { channel: t(`brandKit.channel.${channel}`) })}
                value={locale.disclaimers[channel]}
                onChange={(v) => updateLocale(index, { disclaimers: { ...locale.disclaimers, [channel]: v } })}
                rows={2}
                disabled={!canEdit}
              />
            ))}
          </div>
          {canEdit && form.locales.length > 1 && locale.locale !== form.defaultLocale && (
            <LinkButton danger onClick={() => update({ locales: form.locales.filter((_, i) => i !== index) })}>
              {t('brandKit.locale.remove', { locale: locale.locale })}
            </LinkButton>
          )}
        </Section>
      ))}

      {canEdit && addableLanguages.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label={t('brandKit.locale.add')}
            value={newLocale}
            onChange={setNewLocale}
            options={[{ value: '', label: t('brandKit.locale.choose') }, ...addableLanguages.map((code) => ({ value: code, label: code }))]}
          />
          <SecondaryButton
            disabled={newLocale === ''}
            onClick={() => {
              update({ locales: [...form.locales, emptyLocale(newLocale)] });
              setNewLocale('');
            }}
          >
            {t('brandKit.locale.addButton')}
          </SecondaryButton>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <PrimaryButton onClick={save} disabled={busy || form.brandName.trim() === ''}>
            {t('brandKit.save')}
          </PrimaryButton>
          {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
        </div>
      )}
      {!canEdit && message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}

      <Section title={t('brandKit.facts.title')} description={t('brandKit.facts.hint')}>
        {view.facts.length === 0 ? (
          <p className="ui-text-muted">
            {t('brandKit.facts.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  {[t('brandKit.facts.key'), t('brandKit.facts.category'), t('brandKit.facts.statement'), t('brandKit.facts.validUntil'), ''].map((h, i) => (
                    <Th key={i} className="ui-small">
                      {h}
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {view.facts.map((f) => {
                  const expired = f.validUntil !== null && f.validUntil < today;
                  return (
                    <Tr key={f.id} className="align-top">
                      <Td className="ui-mono ui-small">{f.key}</Td>
                      <Td className="ui-small">{f.category}</Td>
                      <Td>{f.statements[form.defaultLocale] ?? Object.values(f.statements)[0] ?? ''}</Td>
                      <Td className="ui-small">
                        {f.validUntil ?? '-'} {expired && <Badge tone="warning">{t('brandKit.facts.expired')}</Badge>} {!f.isActive && <Badge>{t('brandKit.facts.inactive')}</Badge>}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {canEdit && (
                          <span className="inline-flex gap-3">
                            <LinkButton onClick={() => editFact(f)}>{t('brandKit.facts.edit')}</LinkButton>
                            <LinkButton danger onClick={() => removeFact(f.id)}>
                              {t('brandKit.remove')}
                            </LinkButton>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
        {canEdit && !fact && <SecondaryButton onClick={() => setFact(emptyFact(kitLocales))}>{t('brandKit.facts.add')}</SecondaryButton>}
        {canEdit && fact && (
          <div className="space-y-3 pt-4 ui-rule">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InputField label={t('brandKit.facts.key')} value={fact.key} onChange={(v) => setFact({ ...fact, key: v })} hint={t('brandKit.facts.keyHint')} />
              <InputField label={t('brandKit.facts.category')} value={fact.category} onChange={(v) => setFact({ ...fact, category: v })} />
            </div>
            {Object.keys(fact.statements).map((locale) => (
              <InputField
                key={locale}
                label={t('brandKit.facts.statementIn', { locale })}
                value={fact.statements[locale]}
                onChange={(v) => setFact({ ...fact, statements: { ...fact.statements, [locale]: v } })}
              />
            ))}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InputField label={t('brandKit.facts.sourceUrl')} value={fact.sourceUrl} onChange={(v) => setFact({ ...fact, sourceUrl: v })} placeholder="https://" />
              <InputField label={t('brandKit.facts.validUntil')} type="date" value={fact.validUntil} onChange={(v) => setFact({ ...fact, validUntil: v })} />
            </div>
            <CheckField label={t('brandKit.facts.active')} checked={fact.isActive} onChange={(v) => setFact({ ...fact, isActive: v })} />
            <div className="flex items-center gap-3">
              <PrimaryButton onClick={saveFact} disabled={busy || fact.key.trim() === ''}>
                {t('brandKit.facts.save')}
              </PrimaryButton>
              <SecondaryButton onClick={() => setFact(null)}>{t('brandKit.facts.cancel')}</SecondaryButton>
            </div>
          </div>
        )}
        {factMessage && <InlineMessage text={factMessage.text} tone={factMessage.ok ? 'success' : 'error'} />}
      </Section>
    </div>
  );
}
