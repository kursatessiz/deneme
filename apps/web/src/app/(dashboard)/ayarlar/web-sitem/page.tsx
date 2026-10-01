'use client';

import { useState } from 'react';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { PageGuard } from '@/components/common/PageGuard';
import { SettingsHeader } from '@/components/settings/ui';
import { SiteEditor } from '@/components/sites/SiteEditor';
import { ArticleEditor } from '@/components/sites/ArticleEditor';
import { Tabs } from '@/components/ui';
import { hasAnyPermission } from '@/lib/nav';

/**
 * Tenant "Web sitem": the studio's own public site, built with the same page engine as the platform's site
 * (docs/SAYFA_MOTORU.md), and its blog articles (S2b). Each tab shows only with its permission.
 */
export default function WebSitemPage() {
  const t = useT();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canPages = hasAnyPermission(['site.view', 'site.manage'], permissions, isOwner);
  const canArticles = hasAnyPermission(['sites.articles.manage'], permissions, isOwner);
  const [tab, setTab] = useState<'pages' | 'articles'>(canPages ? 'pages' : 'articles');
  const tabs = [
    ...(canPages ? [{ key: 'pages', label: t('articles.editor.tab.pages') }] : []),
    ...(canArticles ? [{ key: 'articles', label: t('articles.editor.tab.articles') }] : []),
  ];
  return (
    <PageGuard required={['site.view', 'site.manage', 'sites.articles.manage']}>
      <div className="space-y-6">
        <SettingsHeader title={t('settings.site.title')} description={t('settings.site.description')} />
        {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key === 'articles' ? 'articles' : 'pages')} label={t('settings.site.title')} />}
        {tab === 'pages' && canPages ? <SiteEditor studioId={activeStudioId} variant="tenant" /> : null}
        {tab === 'articles' && canArticles ? <ArticleEditor studioId={activeStudioId} variant="tenant" /> : null}
      </div>
    </PageGuard>
  );
}
