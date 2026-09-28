'use client';

import { useEffect, useState } from 'react';
import { BLOCK_TYPES, TENANT_ONLY_BLOCK_TYPES, type BlockType, type PageKind } from '@platform/shared';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/DataState';
import { Badge, InlineMessage, PrimaryButton, SecondaryButton, Section, TextField } from '@/components/settings/ui';

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

function fieldStyle(): React.CSSProperties {
  return {
    borderRadius: 'var(--radius-input)',
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-text-primary)',
  };
}

/**
 * Page engine editor (docs/SAYFA_MOTORU.md), shared by the super admin
 * "Web sitesi" screen (the platform's own site) and the tenant "Web sitem"
 * settings page (permission `site.manage` / `site.view`), which both call
 * the same `/sites/studio/:studioId/*` API scoped to `studioId`.
 */
export function SiteEditor({ studioId, variant }: { studioId: string; variant: 'tenant' | 'platform' }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const { data: site, loading: siteLoading, error: siteError } = useSiteFetch<SiteRow>(`sites/studio/${studioId}`, studioId, refreshKey);
  const { data: pages, loading: pagesLoading, error: pagesError } = useSiteFetch<{ items: PageRow[] }>(`sites/studio/${studioId}/pages`, studioId, refreshKey);

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
      setCreateError('Sayfa için bir etiket girin');
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
      setCreateError(err instanceof BffError ? err.message : 'Sayfa oluşturulamadı');
    }
  };

  const runWizard = async () => {
    setWizardError(null);
    if (!wizardSector.trim()) {
      setWizardError('Sektör anahtarı girin (ör. pilates_studio)');
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
      setWizardError(err instanceof BffError ? err.message : 'Landing sayfası oluşturulamadı');
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
      setDomainError(err instanceof BffError ? err.message : 'Alan adı eklenemedi');
    }
  };

  const selectedPage = selectedPageId ? pages.items.find((p) => p.id === selectedPageId) : null;

  return (
    <div className="space-y-8">
      <Section title="Site ayarları" description={variant === 'platform' ? 'Platformun genel açılış sitesi' : 'İşletmenizin genel web sitesi'}>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Varsayılan dil: <strong>{site.defaultLocale}</strong> · Etkin diller: {site.enabledLocales.join(', ')}
        </p>
        {variant === 'tenant' && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Alan adları
            </h4>
            <ul className="text-sm space-y-1">
              {site.domains.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span>{d.domain}</span>
                  <Badge tone={d.status === 'VERIFIED' ? 'primary' : 'neutral'}>{d.status === 'VERIFIED' ? 'Doğrulandı' : d.status === 'FAILED' ? 'Doğrulanamadı' : 'Bekliyor'}</Badge>
                  {d.status !== 'VERIFIED' && (
                    <SecondaryButton
                      onClick={async () => {
                        await bffFetch(`sites/studio/${studioId}/domains/${d.id}/verify`, { method: 'POST', studioId });
                        refresh();
                      }}
                    >
                      Doğrulamayı kontrol et
                    </SecondaryButton>
                  )}
                </li>
              ))}
              {site.domains.length === 0 && <li style={{ color: 'var(--color-text-muted)' }}>Henüz özel alan adı eklenmedi</li>}
            </ul>
            <div className="flex gap-2 items-end">
              <TextField label="Yeni alan adı" value={newDomain} onChange={setNewDomain} placeholder="site.ornek.com" />
              <SecondaryButton onClick={addDomain}>Ekle</SecondaryButton>
            </div>
            {domainError && <InlineMessage text={domainError} tone="error" />}
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Bir alan adı eklendikten sonra DNS sağlayıcınızda bir TXT ve bir CNAME kaydı oluşturup &quot;Doğrulamayı kontrol et&quot; ile onaylayın.
            </p>
          </div>
        )}
      </Section>

      {variant === 'platform' && (
        <Section title="Landing sayfası oluştur" description="Sektör şablonundan (BusinessTypeTemplate) önceden doldurulmuş bir sayfa oluşturur; sonrasında düzenlenebilir">
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Sektör anahtarı" value={wizardSector} onChange={setWizardSector} placeholder="pilates_studio" />
            <TextField label="Kampanya teklifi (opsiyonel)" value={wizardOffer} onChange={setWizardOffer} placeholder="ucretsiz-deneme" />
          </div>
          {wizardError && <InlineMessage text={wizardError} tone="error" />}
          <PrimaryButton onClick={runWizard}>Landing sayfası oluştur</PrimaryButton>
        </Section>
      )}

      <Section title="Sayfalar">
        <div className="flex gap-2 items-end flex-wrap">
          <TextField label="Yeni sayfa etiketi" value={createLabel} onChange={setCreateLabel} placeholder="ör. Fiyatlandırma" />
          <select value={createKind} onChange={(e) => setCreateKind(e.target.value as PageKind)} className="border px-3 py-2 text-sm" style={fieldStyle()}>
            <option value="HOME">Ana sayfa</option>
            <option value="LANDING">Kampanya / iniş sayfası</option>
            <option value="CORPORATE">Kurumsal</option>
            <option value="LEGAL">Yasal</option>
            <option value="CUSTOM">Diğer</option>
          </select>
          <SecondaryButton onClick={createPage}>Sayfa oluştur</SecondaryButton>
        </div>
        {createError && <InlineMessage text={createError} tone="error" />}

        {pages.items.length === 0 && <EmptyState title="Henüz sayfa yok" />}
        <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {pages.items.map((p) => (
            <li key={p.id} className="py-2 flex items-center justify-between gap-3">
              <button className="text-left flex-1" onClick={() => setSelectedPageId(p.id)}>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {p.internalLabel}
                </span>
                <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
                  {p.kind} · {p.locales.map((l) => l.locale).join(', ') || 'dil eklenmedi'}
                </span>
              </button>
              <Badge tone={p.status === 'PUBLISHED' ? 'primary' : 'neutral'}>{p.status === 'PUBLISHED' ? 'Yayında' : 'Taslak'}</Badge>
            </li>
          ))}
        </ul>
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

function useSiteFetch<T>(path: string, studioId: string, refreshKey: number) {
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
        if (!cancelled) setError(err instanceof BffError ? err.message : 'Yüklenemedi');
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
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  const { data: detail, loading, error } = useSiteFetch<PageRow & { blocks: BlockRow[] }>(`sites/studio/${studioId}/pages/${page.id}`, studioId, refreshKey);
  const { data: versions } = useSiteFetch<{ items: VersionRow[] }>(`sites/studio/${studioId}/pages/${page.id}/versions`, studioId, refreshKey);

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
      setLocaleError('Yol (slug) gereklidir');
      return;
    }
    try {
      await bffFetch(`sites/studio/${studioId}/pages/${page.id}/locales/${activeLocale}`, {
        method: 'PUT',
        studioId,
        body: { slug: slug.trim(), seoTitle: seoTitle.trim() || undefined },
      });
      setActionMessage('Dil bilgisi kaydedildi');
      refresh();
      onChanged();
    } catch (err) {
      setLocaleError(err instanceof BffError ? err.message : 'Kaydedilemedi');
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
      setActionMessage('Bloklar kaydedildi');
      refresh();
    } catch (err) {
      setBlocksError(err instanceof BffError ? err.message : 'Bloklar kaydedilemedi (JSON geçerli mi kontrol edin)');
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
    setActionMessage('Sayfa yayınlandı');
    refresh();
    onChanged();
  };
  const unpublish = async () => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/unpublish`, { method: 'POST', studioId });
    setActionMessage('Sayfa yayından kaldırıldı');
    refresh();
    onChanged();
  };
  const rollback = async (versionId: string) => {
    await bffFetch(`sites/studio/${studioId}/pages/${page.id}/versions/${versionId}/rollback`, { method: 'POST', studioId });
    setActionMessage('Önceki sürüme dönüldü ve yeniden yayınlandı');
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
    <Section title={`Sayfa: ${detail.internalLabel}`}>
      <div className="flex items-center justify-between">
        <Badge tone={detail.status === 'PUBLISHED' ? 'primary' : 'neutral'}>{detail.status === 'PUBLISHED' ? 'Yayında' : 'Taslak'}</Badge>
        <div className="flex gap-2">
          {detail.status === 'PUBLISHED' ? <SecondaryButton onClick={unpublish}>Yayından kaldır</SecondaryButton> : <PrimaryButton onClick={publish}>Yayınla</PrimaryButton>}
          <SecondaryButton onClick={onClose}>Kapat</SecondaryButton>
        </div>
      </div>
      {actionMessage && <InlineMessage text={actionMessage} tone="success" />}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Diller
        </h4>
        <div className="flex gap-2">
          {detail.locales.map((l) => (
            <SecondaryButton key={l.locale} onClick={() => setActiveLocale(l.locale)}>
              {l.locale}
            </SecondaryButton>
          ))}
          {!detail.locales.some((l) => l.locale === activeLocale) && <Badge>{activeLocale} (çevrilmedi)</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Yol (slug)" value={slug} onChange={setSlug} placeholder="pilates" />
          <TextField label="SEO başlığı" value={seoTitle} onChange={setSeoTitle} placeholder="" />
        </div>
        {localeError && <InlineMessage text={localeError} tone="error" />}
        <SecondaryButton onClick={saveLocale}>{activeLocale} için kaydet</SecondaryButton>
        {detail.kind === 'LEGAL' && (
          <div className="flex items-center gap-2">
            <Badge tone={currentLocaleRow?.legalApproved ? 'primary' : 'danger'}>
              {currentLocaleRow?.legalApproved ? 'Hukuki onay alındı' : 'Taslak, hukuki incelemeden geçmeli'}
            </Badge>
            {!currentLocaleRow?.legalApproved ? (
              <SecondaryButton onClick={() => toggleLegalApproval(true)}>Hukuki onay alındı olarak işaretle</SecondaryButton>
            ) : (
              <SecondaryButton onClick={() => toggleLegalApproval(false)}>Onayı geri al</SecondaryButton>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Bloklar
        </h4>
        {blocksDraft.map((b, i) => (
          <div key={b.id} className="p-3 border space-y-2" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{b.type}</span>
              <div className="flex gap-1">
                <SecondaryButton onClick={() => moveBlock(i, -1)}>Yukarı</SecondaryButton>
                <SecondaryButton onClick={() => moveBlock(i, 1)}>Aşağı</SecondaryButton>
                <SecondaryButton danger onClick={() => removeBlock(i)}>
                  Sil
                </SecondaryButton>
              </div>
            </div>
            <textarea
              value={typeof b.data === 'string' ? b.data : JSON.stringify(b.data, null, 2)}
              onChange={(e) => {
                const next = [...blocksDraft];
                next[i] = { ...b, data: e.target.value };
                setBlocksDraft(next);
              }}
              rows={6}
              className="w-full text-xs font-mono px-2 py-2 border"
              style={fieldStyle()}
            />
          </div>
        ))}
        <div className="flex gap-2 items-center flex-wrap">
          <select onChange={(e) => e.target.value && addBlock(e.target.value as BlockType)} value="" className="border px-3 py-2 text-sm" style={fieldStyle()}>
            <option value="">Blok ekle...</option>
            {availableBlockTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <PrimaryButton onClick={saveBlocks}>Blokları kaydet</PrimaryButton>
        </div>
        {blocksError && <InlineMessage text={blocksError} tone="error" />}
      </div>

      {versions && versions.items.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Sürüm geçmişi
          </h4>
          <ul className="text-sm space-y-1">
            {versions.items.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <span>
                  Sürüm {v.version} · {new Date(v.publishedAt).toLocaleString('tr-TR')} {v.publishedByName ? `· ${v.publishedByName}` : ''}
                </span>
                <SecondaryButton onClick={() => rollback(v.id)}>Bu sürüme dön</SecondaryButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
