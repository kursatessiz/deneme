'use client';

import { useState } from 'react';
import { AI_CRAWLER_POLICIES, AI_CRAWLER_USER_AGENTS, SearchVerificationTokenSchema, type AiCrawlerPolicy } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { useT } from '@/components/i18n/I18nProvider';
import { InlineMessage, PrimaryButton, Section, TextField } from '@/components/settings/ui';
import { FieldGroup, Select } from '@/components/ui';

interface SeoValues {
  googleSiteVerification: string | null;
  bingSiteVerification: string | null;
  aiCrawlers: AiCrawlerPolicy;
}

/**
 * Per-site search settings of the page engine editor (docs/SEO.md): the Search Console and Bing verification
 * codes, published as meta tags on every page of the site. Shared by the super admin "Web sitesi" screen (the
 * platform site) and the tenant "Web sitem" settings page; saved through `PATCH /sites/studio/:studioId`.
 */
export function SiteSeoSettings({ studioId, seo, onSaved }: { studioId: string; seo: SeoValues; onSaved: () => void }) {
  const t = useT();
  const [google, setGoogle] = useState(seo.googleSiteVerification ?? '');
  const [bing, setBing] = useState(seo.bingSiteVerification ?? '');
  const [aiCrawlers, setAiCrawlers] = useState<AiCrawlerPolicy>(seo.aiCrawlers);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // An empty value is valid (it removes the tag); anything else must be a plain token.
  const invalid = (value: string): boolean => !SearchVerificationTokenSchema.safeParse(value).success;
  const googleError = invalid(google) ? t('sites.editor.seo.invalidToken') : null;
  const bingError = invalid(bing) ? t('sites.editor.seo.invalidToken') : null;

  const save = async () => {
    setMessage(null);
    if (googleError || bingError) return;
    try {
      await bffFetch(`sites/studio/${studioId}`, { method: 'PATCH', studioId, body: { seo: { googleSiteVerification: google.trim(), bingSiteVerification: bing.trim(), aiCrawlers } } });
      setMessage({ text: t('sites.editor.seo.saved'), ok: true });
      onSaved();
    } catch (err) {
      setMessage({ text: err instanceof BffError ? err.message : t('sites.editor.seo.saveFailed'), ok: false });
    }
  };

  return (
    <Section title={t('sites.editor.seo.title')} description={t('sites.editor.seo.description')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('sites.editor.seo.google')} value={google} onChange={setGoogle} error={googleError} />
        <TextField label={t('sites.editor.seo.bing')} value={bing} onChange={setBing} error={bingError} />
      </div>
      <p className="ui-caption">{t('sites.editor.seo.hint')}</p>
      <FieldGroup label={t('sites.editor.seo.aiCrawlers')} hint={t('sites.editor.seo.aiCrawlers.hint', { agents: AI_CRAWLER_USER_AGENTS.join(', ') })}>
        <Select value={aiCrawlers} onChange={(e) => setAiCrawlers(e.target.value === 'block' ? 'block' : 'allow')} className="w-auto">
          {AI_CRAWLER_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {t(policy === 'block' ? 'sites.editor.seo.aiCrawlers.block' : 'sites.editor.seo.aiCrawlers.allow')}
            </option>
          ))}
        </Select>
      </FieldGroup>
      {message && <InlineMessage text={message.text} tone={message.ok ? 'success' : 'error'} />}
      <PrimaryButton onClick={save}>{t('sites.editor.seo.submit')}</PrimaryButton>
    </Section>
  );
}
