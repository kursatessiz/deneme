'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { AdminLanguageDTO, ImportReportDTO, TranslationEntryDTO } from '@platform/shared';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { LoadingState, ErrorState } from '@/components/common/DataState';
import { useT } from '@/components/i18n/I18nProvider';

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function EntryRow({ code, entry, onSaved }: { code: string; entry: TranslationEntryDTO; onSaved: (entry: TranslationEntryDTO) => void }) {
  const t = useT();
  const [value, setValue] = useState(entry.effective ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (entry.effective ?? '');

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
    <tr className="border-b last:border-0 align-top" style={{ borderColor: 'var(--color-border)' }}>
      <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {entry.key}
        {entry.placeholders.length > 0 && (
          <div className="mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('adminI18n.editor.placeholders')}: {entry.placeholders.map((p) => `{${p}}`).join(', ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {entry.base}
      </td>
      <td className="px-3 py-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={1}
          className="w-full px-2 py-1 border text-sm resize-y"
          style={inputStyle}
        />
        {error && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-danger, #b42318)' }}>
            {error}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={() => save(value)}
          disabled={saving || !dirty}
          className="text-xs font-medium hover:underline disabled:opacity-40 mr-3"
          style={{ color: 'var(--color-primary)' }}
        >
          {t('adminI18n.editor.save')}
        </button>
        <button
          onClick={() => save(null)}
          disabled={saving || entry.override === null}
          className="text-xs font-medium hover:underline disabled:opacity-40"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('adminI18n.editor.resetToBundled')}
        </button>
      </td>
    </tr>
  );
}

export default function AdminI18nEditorPage() {
  const t = useT();
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);

  const { data: languages } = useBff<{ items: AdminLanguageDTO[] }>('admin/i18n/languages', null);
  const language = languages?.items.find((l) => l.code === code);

  const [namespace, setNamespace] = useState('');
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const search = new URLSearchParams();
  if (namespace) search.set('namespace', namespace);
  if (query) search.set('q', query);
  if (onlyMissing) search.set('missingOnly', 'true');
  const entriesPath = `admin/i18n/languages/${code}/entries${search.toString() ? `?${search}` : ''}`;
  const { data, loading, error } = useBff<{ items: TranslationEntryDTO[] }>(entriesPath, null);
  const [entries, setEntries] = useState<TranslationEntryDTO[] | null>(null);
  const items = entries ?? data?.items ?? null;

  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const entry of data?.items ?? []) {
      const dot = entry.key.indexOf('.');
      if (dot > 0) set.add(entry.key.slice(0, dot));
    }
    return [...set].sort();
  }, [data]);

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
        setEntries(null);
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
    <div className="space-y-6" key={refreshKey}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('adminI18n.editor.title', { name: language?.name ?? code })}
          </h2>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/bff/admin/i18n/languages/${code}/export?format=json`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            {t('adminI18n.download.json')}
          </a>
          <a
            href={`/api/bff/admin/i18n/languages/${code}/export?format=csv`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            {t('adminI18n.download.csv')}
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="px-2 py-1.5 border text-sm" style={inputStyle}>
          <option value="">{t('common.all')}</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('adminI18n.editor.search')}
          className="px-2 py-1.5 border text-sm"
          style={inputStyle}
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          {t('adminI18n.editor.onlyMissing')}
        </label>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-muted)' }}>
              <th className="px-3 py-2 font-medium">{t('adminI18n.editor.key')}</th>
              <th className="px-3 py-2 font-medium">{t('adminI18n.editor.source')}</th>
              <th className="px-3 py-2 font-medium">{t('adminI18n.editor.value')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((entry) => (
              <EntryRow key={entry.key} code={code} entry={entry} onSaved={onEntrySaved} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border p-5 max-w-xl" style={{ borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          {t('adminI18n.upload.title')}
        </h3>
        <div className="space-y-3">
          <input type="file" accept=".json,.csv" onChange={onFileChange} className="text-sm" />
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              {t('adminI18n.upload.merge')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              {t('adminI18n.upload.replace')}
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runImport(true)}
              disabled={!uploadFile || uploading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
            >
              {t('adminI18n.upload.check')}
            </button>
            <button
              onClick={() => runImport(false)}
              disabled={!uploadFile || uploading || !report || !report.applied}
              className="px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {t('adminI18n.upload.apply')}
            </button>
          </div>
          {uploadError && (
            <p className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
              {uploadError}
            </p>
          )}
          {report && (
            <div className="text-xs space-y-1 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
              {!report.applied && (
                <p className="font-medium" style={{ color: 'var(--color-danger, #b42318)' }}>
                  {t('adminI18n.upload.blocked')}
                </p>
              )}
              {report.applied && !report.dryRun && (
                <p className="font-medium" style={{ color: 'var(--color-success, #12a150)' }}>
                  {t('adminI18n.upload.applied')}
                </p>
              )}
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
        </div>
      </div>
    </div>
  );
}
