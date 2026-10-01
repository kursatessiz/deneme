'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { BASE_LOCALE, BASE_MESSAGES, type AdminLanguageDTO, type ImportReportDTO, type TranslationEntryDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';
import { AiTranslatePanel } from '@/components/admin/AiTranslatePanel';
import { GlossaryPanel } from '@/components/admin/GlossaryPanel';
import { Badge } from '@/components/ui/Badge';
import { AnchorButton } from '@/components/ui/LinkButton';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Radio } from '@/components/ui/Radio';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';

type SourceFilter = '' | 'AI_UNREVIEWED' | 'AI' | 'MANUAL' | 'UPLOAD';
const SOURCE_FILTERS: readonly SourceFilter[] = ['', 'AI_UNREVIEWED', 'AI', 'MANUAL', 'UPLOAD'];

function SourceBadge({ entry }: { entry: TranslationEntryDTO }) {
  const t = useT();
  if (!entry.source) return null;
  const pending = entry.source === 'AI' && entry.reviewedAt === null;
  return <Badge tone={pending ? 'warn' : 'muted'}>{pending ? t('adminI18n.source.aiUnreviewed') : t(`adminI18n.source.${entry.source}`)}</Badge>;
}

function EntryRow({ code, entry, onSaved }: { code: string; entry: TranslationEntryDTO; onSaved: (entry: TranslationEntryDTO) => void }) {
  const t = useT();
  const [value, setValue] = useState(entry.effective ?? '');
  // Rows are keyed by message key, so a value that changes on the server
  // (an AI job finishing, a pack upload) must replace the local copy.
  useEffect(() => {
    setValue(entry.effective ?? '');
  }, [entry.effective]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (entry.effective ?? '');

  async function approve() {
    setSaving(true);
    setError(null);
    try {
      await bffFetch(`admin/i18n/languages/${code}/review`, { method: 'POST', body: { keys: [entry.key] } });
      onSaved({ ...entry, reviewedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function save(nextValue: string | null) {
    setSaving(true);
    setError(null);
    try {
      const updated = await bffFetch<TranslationEntryDTO>(`admin/i18n/languages/${code}/entries/${encodeURIComponent(entry.key)}`, {
        method: 'PUT',
        body: { value: nextValue },
      });
      setValue(updated.effective ?? '');
      onSaved(updated);
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('adminI18n.editor.placeholderMismatch'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Tr className="align-top">
      <Td className="ui-mono ui-text-muted">
        {entry.key}
        <div className="flex flex-wrap items-center gap-1">
          <SourceBadge entry={entry} />
          {entry.isPluralExtension && <span className="ui-caption">{t('adminI18n.editor.pluralExtension')}</span>}
        </div>
        {entry.placeholders.length > 0 && (
          <div className="ui-caption">
            {t('adminI18n.editor.placeholders')}: {entry.placeholders.map((p) => `{${p}}`).join(', ')}
          </div>
        )}
      </Td>
      <Td className="ui-small">{entry.base}</Td>
      <Td>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={1} className="resize-y" />
        {error && <p className="ui-caption ui-text-error">{error}</p>}
      </Td>
      <Td className="text-right whitespace-nowrap">
        {entry.source === 'AI' && entry.reviewedAt === null && (
          <Button variant="link" size="sm" onClick={approve} disabled={saving || dirty}>
            {t('adminI18n.editor.approve')}
          </Button>
        )}
        <Button variant="link" size="sm" onClick={() => save(value)} disabled={saving || !dirty}>
          {t('adminI18n.editor.save')}
        </Button>
        <Button variant="link" tone="muted" size="sm" onClick={() => save(null)} disabled={saving || entry.override === null}>
          {t('adminI18n.editor.resetToBundled')}
        </Button>
      </Td>
    </Tr>
  );
}

export default function AdminI18nEditorPage() {
  const t = useT();
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);

  const [refreshKey, setRefreshKey] = useState(0);
  const { data: languages } = useBff<{ items: AdminLanguageDTO[] }>('admin/i18n/languages', null, refreshKey);
  const language = languages?.items.find((l) => l.code === code);

  const [namespace, setNamespace] = useState('');
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [version, setVersion] = useState(0);

  const search = new URLSearchParams();
  if (namespace) search.set('namespace', namespace);
  if (query) search.set('q', query);
  if (onlyMissing) search.set('missingOnly', 'true');
  if (sourceFilter) search.set('source', sourceFilter);
  const entriesPath = `admin/i18n/languages/${code}/entries${search.toString() ? `?${search}` : ''}`;
  const [data, setData] = useState<{ items: TranslationEntryDTO[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranslationEntryDTO[] | null>(null);
  const items = entries ?? data?.items ?? null;

  // Reloaded when the filters change and when an AI job reports progress (version).
  useEffect(() => {
    let cancelled = false;
    bffFetch<{ items: TranslationEntryDTO[] }>(entriesPath)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setEntries(null);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof BffError ? err.message : t('common.error.generic'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entriesPath, version, t]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const namespaces = useMemo(() => [...new Set(Object.keys(BASE_MESSAGES).map((k) => k.split('.')[0]))].sort(), []);
  const unreviewedVisible = (items ?? []).filter((e) => e.source === 'AI' && e.reviewedAt === null).map((e) => e.key);
  const [approving, setApproving] = useState(false);

  async function approveVisible() {
    if (unreviewedVisible.length === 0) return;
    setApproving(true);
    try {
      await bffFetch(`admin/i18n/languages/${code}/review`, { method: 'POST', body: { keys: unreviewedVisible } });
      reload();
    } finally {
      setApproving(false);
    }
  }

  function onEntrySaved(updated: TranslationEntryDTO) {
    setEntries((prev) => (prev ?? data?.items ?? []).map((e) => (e.key === updated.key ? updated : e)));
  }

  // -- upload -------------------------------------------------------------
  const [uploadFile, setUploadFile] = useState<{ name: string; content: string; format: 'json' | 'csv' } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [report, setReport] = useState<ImportReportDTO | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setReport(null);
    setUploadError(null);
    if (!file) {
      setUploadFile(null);
      return;
    }
    const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
    const content = await file.text();
    setUploadFile({ name: file.name, content, format });
  }

  async function runImport(dryRun: boolean) {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await bffFetch<ImportReportDTO>(`admin/i18n/languages/${code}/import`, {
        method: 'POST',
        body: { format: uploadFile.format, content: uploadFile.content, dryRun, mode },
      });
      setReport(result);
      if (!dryRun && result.applied) {
        setRefreshKey((k) => k + 1);
        reload();
      }
    } catch (err) {
      setUploadError(err instanceof BffError ? err.message : t('adminI18n.upload.blocked'));
    } finally {
      setUploading(false);
    }
  }

  if (loading && !items) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="grid gap-6" key={refreshKey}>
      <PageHeader
        title={t('adminI18n.editor.title', { name: language?.name ?? code })}
        actions={
          <>
            <AnchorButton href={`/api/bff/admin/i18n/languages/${code}/export?format=json`} variant="outline" tone="surface" size="sm">
              {t('adminI18n.download.json')}
            </AnchorButton>
            <AnchorButton href={`/api/bff/admin/i18n/languages/${code}/export?format=csv`} variant="outline" tone="surface" size="sm">
              {t('adminI18n.download.csv')}
            </AnchorButton>
          </>
        }
      />

      {code === BASE_LOCALE ? (
        <p className="ui-caption">{t('adminI18n.ai.baseLanguage')}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AiTranslatePanel code={code} onProgress={reload} />
          <GlossaryPanel code={code} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="w-auto">
          <option value="">{t('common.all')}</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </Select>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('adminI18n.editor.search')} className="w-auto" />
        <Checkbox label={t('adminI18n.editor.onlyMissing')} checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        <label className="inline-flex items-center gap-2" htmlFor="i18n-source-filter">
          <span className="ui-small">{t('adminI18n.editor.sourceFilter')}</span>
          <Select id="i18n-source-filter" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} className="w-auto">
            {SOURCE_FILTERS.map((f) => (
              <option key={f || 'all'} value={f}>
                {f === '' ? t('common.all') : f === 'AI_UNREVIEWED' ? t('adminI18n.source.aiUnreviewed') : t(`adminI18n.source.${f}`)}
              </option>
            ))}
          </Select>
        </label>
        {unreviewedVisible.length > 0 && (
          <Button variant="outline" tone="surface" size="sm" onClick={approveVisible} disabled={approving}>
            {t('adminI18n.editor.approveVisible')}
          </Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>{t('adminI18n.editor.key')}</Th>
              <Th>{t('adminI18n.editor.source')}</Th>
              <Th>{t('adminI18n.editor.value')}</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {(items ?? []).map((entry) => (
              <EntryRow key={entry.key} code={code} entry={entry} onSaved={onEntrySaved} />
            ))}
          </Tbody>
        </Table>
      </Card>

      <Card as="section" className="max-w-xl">
        <CardContent>
          <h3 className="ui-heading">{t('adminI18n.upload.title')}</h3>
          <Input type="file" accept=".json,.csv" onChange={onFileChange} />
          <div className="flex items-center gap-4">
            <Radio label={t('adminI18n.upload.merge')} checked={mode === 'merge'} onChange={() => setMode('merge')} />
            <Radio label={t('adminI18n.upload.replace')} checked={mode === 'replace'} onChange={() => setMode('replace')} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" tone="surface" size="sm" onClick={() => runImport(true)} disabled={!uploadFile || uploading}>
              {t('adminI18n.upload.check')}
            </Button>
            <Button size="sm" onClick={() => runImport(false)} disabled={!uploadFile || uploading || !report || !report.applied}>
              {t('adminI18n.upload.apply')}
            </Button>
          </div>
          {uploadError && <p className="ui-caption ui-text-error">{uploadError}</p>}
          {report && (
            <div className="ui-panel ui-small grid gap-1 p-3">
              {!report.applied && <p className="ui-strong ui-text-error">{t('adminI18n.upload.blocked')}</p>}
              {report.applied && !report.dryRun && <p className="ui-strong ui-text-success">{t('adminI18n.upload.applied')}</p>}
              <p>
                {t('adminI18n.upload.report.accepted')}: {report.acceptedCount} · {t('adminI18n.upload.report.changed')}: {report.changedCount} ·{' '}
                {t('adminI18n.upload.report.removed')}: {report.removedCount}
              </p>
              {report.unknownKeys.length > 0 && (
                <p>
                  {t('adminI18n.upload.report.unknown')}: {report.unknownKeys.join(', ')}
                </p>
              )}
              {report.emptyKeys.length > 0 && (
                <p>
                  {t('adminI18n.upload.report.empty')}: {report.emptyKeys.length}
                </p>
              )}
              {report.placeholderMismatches.length > 0 && (
                <p>
                  {t('adminI18n.upload.report.mismatch')}:{' '}
                  {report.placeholderMismatches.map((m) => `${m.key} (${m.expected.join(',') || '-'} != ${m.actual.join(',') || '-'})`).join('; ')}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
