'use client';

import { useEffect, useState } from 'react';
import { BLOCK_TYPES, TENANT_ONLY_BLOCK_TYPES, type BlockType, type PageKind } from '@platform/shared';
import type { Translate } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, TextField } from '@/components/settings/ui';
import { ChipButton, FieldGroup, List, ListItem, Select, Textarea } from '@/components/ui';
import { SiteSeoSettings } from './SiteSeoSettings';

interface PageLocaleRow {
  locale: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  legalApproved: boolean;
}
interface PageRow {
  id: string;
  kind: PageKind;
  sectorKey: string | null;
  offerKey: string | null;
  internalLabel: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  locales: PageLocaleRow[];
}
interface BlockRow {
  id: string;
  type: BlockType;
  position: number;
  abVariantKey: string | null;
  data: unknown;
}
interface VersionRow {
  id: string;
  version: number;
  publishedAt: string;
  publishedByName: string | null;
}
interface SiteRow {
  id: string;
  kind: 'PLATFORM' | 'TENANT';
  primaryDomain: string | null;
  defaultLocale: string;
  enabledLocales: string[];
  domains: Array<{ id: string; domain: string; status: string; verificationToken: string }>;
  seo: { googleSiteVerification: string | null; bingSiteVerification: string | null; aiCrawlers: 'allow' | 'block'; showAggregateRating: boolean };
}

const BLOCK_TEMPLATE: Record<BlockType, unknown> = {
  hero: { config: {}, text: { tr: { title: 'Başlık' } } },
  feature_grid: { config: {}, text: { tr: { title: 'Özellikler', items: [] } } },
  sector_cards: { config: { sectorKeys: [] }, text: { tr: {} } },
  how_it_works: { config: {}, text: { tr: { title: 'Nasıl çalışır', steps: [] } } },
  pricing: { config: { hidden: false }, text: { tr: {} } },
  testimonials: { config: {}, text: { tr: { items: [] } } },
  faq: { config: {}, text: { tr: { items: [] } } },
  stats: { config: {}, text: { tr: { items: [] } } },
  cta: { config: {}, text: { tr: { title: 'Hemen başlayın', buttonLabel: 'İletişime geçin', buttonHref: '#iletisim' } } },
  lead_form: { config: { fields: ['fullName', 'phone'] }, text: { tr: { title: 'Bize ulaşın', submitLabel: 'Gönder' } } },
  booking_widget: { config: {}, text: { tr: { title: 'Randevu al', buttonLabel: 'Randevu al' } } },
  trainers: { config: {}, text: { tr: { title: 'Eğitmenlerimiz', items: [] } } },
  contact: { config: { showAddress: true, showPhone: true, showEmail: true }, text: { tr: {} } },
  legal_text: { config: {}, text: { tr: { title: 'Başlık', body: 'Metin' } } },
};

/**
 * Page engine editor (docs/SAYFA_MOTORU.md), shared by the super admin
 * "Web sitesi" screen (the platform's own site) and the tenant "Web sitem"
 * settings page (permission `site.manage` / `site.view`), which both call
 * the same `/sites/studio/:studioId/*` API scoped to `studioId`.
 */
export function SiteEditor({ studioId, variant }: { studioId: string; variant: 'tenant' | 'platform' }) {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const { data: site, loading: siteLoading, error: siteError } = useSiteFetch<SiteRow>(`sites/studio/${studioId}`, studioId, refreshKey, t);
  const { data: pages, loading: pagesLoading, error: pagesError } = useSiteFetch<{ items: PageRow[] }>(`sites/studio/${studioId}/pages`, studioId, refreshKey, t);

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [createLabel, setCreateLabel] = useState('');
  const [createKind, setCreateKind] = useState<PageKind>('LANDING');
  const [createError, setCreateError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [wizardSector, setWizardSector] = useState('');
  const [wizardOffer, setWizardOffer] = useState('');
  const [wizardError, setWizardError] = useState<string | null>(null);

  if (siteLoading || pagesLoading) return <LoadingState />;
  if (siteError) return <ErrorState message={siteError} />;
  if (pagesError) return <ErrorState message={pagesError} />;
  if (!site || !pages) return null;

  const createPage = async () => {
    setCreateError(null);
    if (!createLabel.trim()) {
      setCreateError(t('sites.editor.pages.labelRequired'));
      return;
    }
    try {
      const page = await bffFetch<PageRow>(`sites/studio/${studioId}/pages`, {
        method: 'POST',
        studioId,
        body: { kind: createKind, internalLabel: createLabel },
      });
      setCreateLabel('');
      refresh();
      setSelectedPageId(page.id);
    } catch (err) {
      setCreateError(err instanceof BffError ? err.message : t('sites.editor.pages.createFailed'));
    }
  };

  const runWizard = async () => {
    setWizardError(null);
    if (!wizardSector.trim()) {
      setWizardError(t('sites.editor.wizard.sectorRequired'));
      return;
    }
    try {
      const page = await bffFetch<PageRow>(`sites/studio/${studioId}/pages/wizard`, {
        method: 'POST',
        studioId,
        body: { sectorKey: wizardSector.trim(), offerKey: wizardOffer.trim() || undefined, locales: site.enabledLocales },
      });
      setWizardSector('');
      setWizardOffer('');
      refresh();
      setSelectedPageId(page.id);
    } catch (err) {
      setWizardError(err instanceof BffError ? err.message : t('sites.editor.wizard.createFailed'));
    }
  };

  const addDomain = async () => {
    setDomainError(null);
    if (!newDomain.trim()) return;
    try {
      await bffFetch(`sites/studio/${studioId}/domains`, { method: 'POST', studioId, body: { domain: newDomain.trim() } });
      setNewDomain('');
      refresh();
    } catch (err) {
      setDomainError(err instanceof BffError ? err.message : t('sites.editor.domains.addFailed'));
    }
  };

  const selectedPage = selectedPageId ? pages.items.find((p) => p.id === selectedPageId) : null;

  return (
    <div className="grid gap-6">
      <Section
        title={t('sites.editor.settings.title')}
        description={variant === 'platform' ? t('sites.editor.settings.platformDescription') : t('sites.editor.settings.tenantDescription')}
      >
        <p className="ui-text-muted">{t('sites.editor.settings.summary', { locale: site.defaultLocale, locales: site.enabledLocales.join(', ') })}</p>
        {variant === 'tenant' && (
          <div className="grid gap-3 ui-rule pt-4">
            <h4 className="ui-heading">{t('sites.editor.domains.title')}</h4>
            <List>
              {site.domains.map((d) => (
                <ListItem key={d.id} className="flex items-center gap-2">
                  <span>{d.domain}</span>
                  <Badge tone={d.status === 'VERIFIED' ? 'primary' : 'neutral'}>
                    {d.status === 'VERIFIED'
                      ? t('sites.editor.domains.status.verified')
                      : d.status === 'FAILED'
                        ? t('sites.editor.domains.status.failed')
                        : t('sites.editor.domains.status.pending')}
                  </Badge>
                  {d.status !== 'VERIFIED' && (
                    <SecondaryButton
                      onClick={async () => {
                        await bffFetch(`sites/studio/${studioId}/domains/${d.id}/verify`, { method: 'POST', studioId });
                        refresh();
                      }}
                    >
                      {t('sites.editor.domains.verifyCheck')}
                    </SecondaryButton>
                  )}
                </ListItem>
              ))}
              {site.domains.length === 0 && <ListItem className="ui-text-muted">{t('sites.editor.domains.empty')}</ListItem>}
            </List>
            <div className="flex gap-2 items-end">
              <TextField label={t('sites.editor.domains.newDomainLabel')} value={newDomain} onChange={setNewDomain} placeholder="site.ornek.com" />
              <SecondaryButton onClick={addDomain}>{t('sites.editor.domains.add')}</SecondaryButton>
            </div>
            {domainError && <InlineMessage text={domainError} tone="error" />}
            <p className="ui-caption">{t('sites.editor.domains.hint')}</p>
          </div>
        )}
      </Section>

      <SiteSeoSettings studioId={studioId} seo={site.seo} variant={variant} onSaved={refresh} />

      {variant === 'platform' && (
        <Section title={t('sites.editor.wizard.title')} description={t('sites.editor.wizard.description')}>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('sites.editor.wizard.sectorKey')} value={wizardSector} onChange={setWizardSector} placeholder="pilates_studio" />
            <TextField label={t('sites.editor.wizard.offerKey')} value={wizardOffer} onChange={setWizardOffer} placeholder="ucretsiz-deneme" />
          </div>
          {wizardError && <InlineMessage text={wizardError} tone="error" />}
          <PrimaryButton onClick={runWizard}>{t('sites.editor.wizard.submit')}</PrimaryButton>
        </Section>
      )}

      <Section title={t('sites.editor.pages.title')}>
        <div className="flex gap-2 items-end flex-wrap">
          <TextField label={t('sites.editor.pages.newLabel')} value={createLabel} onChange={setCreateLabel} placeholder={t('sites.editor.pages.newLabelPlaceholder')} />
          <Select value={createKind} onChange={(e) => setCreateKind(e.target.value as PageKind)} aria-label={t('sites.editor.pages.kindLabel')} className="w-auto">
            <option value="HOME">{t('sites.editor.pages.kind.HOME')}</option>
            <option value="LANDING">{t('sites.editor.pages.kind.LANDING')}</option>
            <option value="CORPORATE">{t('sites.editor.pages.kind.CORPORATE')}</option>
            <option value="LEGAL">{t('sites.editor.pages.kind.LEGAL')}</option>
            <option value="CUSTOM">{t('sites.editor.pages.kind.CUSTOM')}</option>
          </Select>
          <SecondaryButton onClick={createPage}>{t('sites.editor.pages.create')}</SecondaryButton>
        </div>
        {createError && <InlineMessage text={createError} tone="error" />}

        {pages.items.length === 0 && <EmptyState title={t('sites.editor.pages.empty')} />}
        <List>
          {pages.items.map((p) => (
            <ListItem key={p.id} className="ui-pick flex items-center justify-between gap-3" aria-current={p.id === selectedPageId ? 'true' : undefined}>
              <button type="button" className="text-left flex-1 flex flex-wrap items-baseline gap-2" onClick={() => setSelectedPageId(p.id)}>
                <span className="ui-strong">{p.internalLabel}</span>
                <span className="ui-caption">
                  {p.kind} &middot; {p.locales.map((l) => l.locale).join(', ') || t('sites.editor.pages.noLocales')}
                </span>
              </button>
              <Badge tone={p.status === 'PUBLISHED' ? 'primary' : 'neutral'}>{p.status === 'PUBLISHED' ? t('sites.editor.pages.published') : t('sites.editor.pages.draft')}</Badge>
            </ListItem>
          ))}
        </List>
      </Section>

      {selectedPage && (
        <PageDetailEditor
          key={selectedPage.id}
          studioId={studioId}
          page={selectedPage}
          siteKind={site.kind}
          onChanged={refresh}
          onClose={() => setSelectedPageId(null)}
        />
      )}
    </div>
  );
}

function useSiteFetch<T>(path: string, studioId: string, refreshKey: number, t: Translate) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    bffFetch<T>(path, { studioId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof BffError ? err.message : t('sites.editor.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, studioId, refreshKey]);
  return { data, loading, error };
}

function PageDetailEditor({
  studioId,
  page,
  siteKind,
  onChanged,
  onClose,
}: {
  studioId: string;
  page: PageRow;
  siteKind: 'PLATFORM' | 'TENANT';
  onChanged: () => void;
  onClose: () => void;
}) {
  const uiLocale = useLocale();
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  const { data: detail, loading, error } = useSiteFetch<PageRow & { blocks: BlockRow[] }>(`sites/studio/${studioId}/pages/${page.id}`, studioId, refreshKey, t);
  const { data: versions } = useSiteFetch<{ items: VersionRow[] }>(`sites/studio/${studioId}/pages/${page.id}/versions`, studioId, refreshKey, t);

  const [activeLocale, setActiveLocale] = useState('tr');
  const [slug, setSlug] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [localeError, setLocaleError] = useState<string | null>(null);
  const [blocksDraft, setBlocksDraft] = useState<BlockRow[] | null>(null);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) return;
    setBlocksDraft(detail.blocks);
    const l = detail.locales.find((x) => x.locale === activeLocale);
    setSlug(l?.slug ?? '');
    setSeoTitle(l?.seoTitle ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, refreshKey]);

  useEffect(() => {
    const l = detail?.locales.find((x) => x.locale === activeLocale);
    setSlug(l?.slug ?? '');
    setSeoTitle(l?.seoTitle ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocale]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!detail || !blocksDraft) return null;

  const availableBlockTypes = BLOCK_TYPES.filter((t) => siteKind === 'PLATFORM' ? !TENANT_ONLY_BLOCK_TYPES.includes(t) : true);

  const saveLocale = async () => {
    setLocaleError(null);
    if (!slug.trim()) {
      setLocaleError(t('sites.editor.detail.localeRequired'));
      return;
    }
    try {
      await bffFetch(`sites/studio/${studioId}/pages/${page.id}/locales/${activeLocale}`, {
        method: 'PUT',
        studioId,
        body: { slug: slug.trim(), seoTitle: seoTitle.trim() || undefined },
      });
      setActionMessage(t('sites.editor.detail.localeSaved'));
      refresh();
      onChanged();
    } catch (err) {
      setLocaleError(err instanceof BffError ? err.message : t('sites.editor.detail.localeSaveFailed'));
    }
  };

  const saveBlocks = async () => {
    setBlocksError(null);
    try {
      const parsed = blocksDraft.map((b, i) => ({ ...b, position: i, data: typeof b.data === 'string' ? JSON.parse(b.data) : b.data }));
      await bffFetch(`sites/studio/${studioId}/pages/${page.id}/blocks`, {
        method: 'PUT',
        studioId,
        body: parsed.map((b) => ({ type: b.type, position: b.position, abVariantKey: b.abVariantKey, data: b.data })),
      });
      setActionMessage(t('sites.editor.blocks.saved'));
      refresh();
    } catch (err) {
      setBlocksError(err instanceof BffError ? err.message : t('sites.editor.blocks.saveFailed'));
    }
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const next = [...blocksDraft];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBlocksDraft(next);
  };

  const removeBlock = (index: number) => setBlocksDraft(blocksDraft.filter((_, i) => i !== index));

  const addBlock = (type: BlockType) => {
    setBlocksDraft([...blocksDraft, { id: `new-${Date.now()}`, type, position: blocksDraft.length, abVariantKey: null, data: BLOCK_TEMPLATE[type] }]);
  };

  const publish = async () => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/publish`, { method: 'POST', studioId });
    setActionMessage(t('sites.editor.detail.published'));
    refresh();
    onChanged();
  };
  const unpublish = async () => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/unpublish`, { method: 'POST', studioId });
    setActionMessage(t('sites.editor.detail.unpublished'));
    refresh();
    onChanged();
  };
  const rollback = async (versionId: string) => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/versions/${versionId}/rollback`, { method: 'POST', studioId });
    setActionMessage(t('sites.editor.versions.rolledBack'));
    refresh();
    onChanged();
  };
  const toggleLegalApproval = async (approved: boolean) => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/locales/${activeLocale}/legal-approval`, {
      method: 'PATCH',
      studioId,
      body: { approved },
    });
    refresh();
  };

  const currentLocaleRow = detail.locales.find((l) => l.locale === activeLocale);

  return (
    <Section title={t('sites.editor.detail.title', { label: detail.internalLabel })}>
      <div className="flex items-center justify-between">
        <Badge tone={detail.status === 'PUBLISHED' ? 'primary' : 'neutral'}>
          {detail.status === 'PUBLISHED' ? t('sites.editor.pages.published') : t('sites.editor.pages.draft')}
        </Badge>
        <div className="flex gap-2">
          {detail.status === 'PUBLISHED' ? (
            <SecondaryButton onClick={unpublish}>{t('sites.editor.detail.unpublish')}</SecondaryButton>
          ) : (
            <PrimaryButton onClick={publish}>{t('sites.editor.detail.publish')}</PrimaryButton>
          )}
          <SecondaryButton onClick={onClose}>{t('sites.editor.detail.close')}</SecondaryButton>
        </div>
      </div>
      {actionMessage && <InlineMessage text={actionMessage} tone="success" />}

      <div className="grid gap-3 ui-rule pt-4">
        <h4 className="ui-heading">{t('sites.editor.detail.localesTitle')}</h4>
        <div className="flex flex-wrap gap-2">
          {detail.locales.map((l) => (
            <ChipButton key={l.locale} selected={l.locale === activeLocale} onClick={() => setActiveLocale(l.locale)}>
              {l.locale}
            </ChipButton>
          ))}
          {!detail.locales.some((l) => l.locale === activeLocale) && (
            <Badge>
              {activeLocale} {t('sites.editor.detail.notTranslated')}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('sites.editor.detail.slug')} value={slug} onChange={setSlug} placeholder="pilates" />
          <TextField label={t('sites.editor.detail.seoTitle')} value={seoTitle} onChange={setSeoTitle} placeholder="" />
        </div>
        {localeError && <InlineMessage text={localeError} tone="error" />}
        <SecondaryButton onClick={saveLocale}>{t('sites.editor.detail.saveLocale', { locale: activeLocale })}</SecondaryButton>
        {detail.kind === 'LEGAL' && (
          <div className="flex items-center gap-2">
            <Badge tone={currentLocaleRow?.legalApproved ? 'primary' : 'danger'}>
              {currentLocaleRow?.legalApproved ? t('sites.editor.detail.legalApproved') : t('sites.editor.detail.legalPending')}
            </Badge>
            {!currentLocaleRow?.legalApproved ? (
              <SecondaryButton onClick={() => toggleLegalApproval(true)}>{t('sites.editor.detail.markLegalApproved')}</SecondaryButton>
            ) : (
              <SecondaryButton onClick={() => toggleLegalApproval(false)}>{t('sites.editor.detail.revokeLegalApproval')}</SecondaryButton>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 ui-rule pt-4">
        <h4 className="ui-heading">{t('sites.editor.blocks.title')}</h4>
        {blocksDraft.map((b, i) => (
          <div key={b.id} className="ui-panel p-3 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="ui-strong ui-mono">{b.type}</span>
              <div className="flex flex-wrap gap-1">
                <SecondaryButton onClick={() => moveBlock(i, -1)}>{t('sites.editor.blocks.moveUp')}</SecondaryButton>
                <SecondaryButton onClick={() => moveBlock(i, 1)}>{t('sites.editor.blocks.moveDown')}</SecondaryButton>
                <SecondaryButton danger onClick={() => removeBlock(i)}>
                  {t('sites.editor.blocks.delete')}
                </SecondaryButton>
              </div>
            </div>
            <TextField
              label={t('sites.editor.blocks.abVariant')}
              value={b.abVariantKey ?? ''}
              placeholder={t('sites.editor.blocks.abVariantPlaceholder')}
              onChange={(v) => {
                const next = [...blocksDraft];
                next[i] = { ...b, abVariantKey: v.trim() ? v : null };
                setBlocksDraft(next);
              }}
            />
            <FieldGroup label={t('sites.editor.blocks.data')} hint={t('sites.editor.blocks.dataHint')}>
              <Textarea
                value={typeof b.data === 'string' ? b.data : JSON.stringify(b.data, null, 2)}
                onChange={(e) => {
                  const next = [...blocksDraft];
                  next[i] = { ...b, data: e.target.value };
                  setBlocksDraft(next);
                }}
                rows={6}
                className="ui-mono"
              />
            </FieldGroup>
          </div>
        ))}
        <div className="flex gap-2 items-center flex-wrap">
          <Select onChange={(e) => e.target.value && addBlock(e.target.value as BlockType)} value="" aria-label={t('sites.editor.blocks.addPlaceholder')} className="w-auto">
            <option value="">{t('sites.editor.blocks.addPlaceholder')}</option>
            {availableBlockTypes.map((blockType) => (
              <option key={blockType} value={blockType}>
                {blockType}
              </option>
            ))}
          </Select>
          <PrimaryButton onClick={saveBlocks}>{t('sites.editor.blocks.save')}</PrimaryButton>
        </div>
        {blocksError && <InlineMessage text={blocksError} tone="error" />}
      </div>

      {versions && versions.items.length > 0 && (
        <div className="grid gap-3 ui-rule pt-4">
          <h4 className="ui-heading">{t('sites.editor.versions.title')}</h4>
          <List>
            {versions.items.map((v) => (
              <ListItem key={v.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {t('sites.editor.versions.entry', {
                    version: v.version,
                    date: new Date(v.publishedAt).toLocaleString(uiLocale),
                    author: v.publishedByName ? t('sites.editor.versions.authorSuffix', { name: v.publishedByName }) : '',
                  })}
                </span>
                <SecondaryButton onClick={() => rollback(v.id)}>{t('sites.editor.versions.rollback')}</SecondaryButton>
              </ListItem>
            ))}
          </List>
        </div>
      )}
    </Section>
  );
}
