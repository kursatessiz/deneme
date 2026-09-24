'use client';

import { useEffect, useState } from 'react';
import type { ExpenseDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { formatMoney, sumMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';

type ExpenseRow = ExpenseDTO;

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function NewExpenseDialog({ studioId, onClose, onDone }: { studioId: string; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!category.trim() || !Number.isFinite(value) || value <= 0) {
      setError('Kategori ve tutar giriniz');
      return;
    }
    setSubmitting(true);
    try {
      await bffFetch('expenses', {
        method: 'POST',
        studioId,
        body: {
          category: category.trim(),
          amount: value,
          spentAt: new Date(`${spentAt}T00:00:00.000Z`).toISOString(),
          note: note.trim() || undefined,
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : 'Gider kaydedilemedi');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Yeni gider" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input placeholder="Kategori (örn. Kira)" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full text-sm px-3 py-1.5" style={inputStyle} />
        <input type="number" min="0.01" step="0.01" placeholder="Tutar" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-sm px-3 py-1.5" style={inputStyle} />
        <input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="w-full text-sm px-3 py-1.5" style={inputStyle} />
        <textarea placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} className="w-full text-sm px-3 py-1.5" style={{ ...inputStyle, minHeight: 60 }} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </PermissionButton>
          <PermissionButton required={['finance.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Kaydediliyor...' : 'Kaydet'}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

export function ExpensesTab() {
  const { activeStudioId } = useDashboardSession();
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!activeStudioId) return;
    setLoading(true);
    setError(null);
    const qs = buildReportQuery({ from, to, branchId: branchId || null });
    bffFetch<ExpenseRow[]>(`expenses/studio/${activeStudioId}${qs ? `?${qs}` : ''}`, { studioId: activeStudioId })
      .then(setExpenses)
      .catch((err) => setError(err instanceof BffError ? err.message : 'Giderler yüklenemedi'))
      .finally(() => setLoading(false));
  }, [activeStudioId, branchId, from, to, reloadKey]);

  async function handleDelete(id: string) {
    if (!activeStudioId) return;
    if (!window.confirm('Bu gideri silmek istediğinize emin misiniz?')) return;
    try {
      await bffFetch(`expenses/${id}/studio/${activeStudioId}`, { method: 'DELETE', studioId: activeStudioId });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : 'Gider silinemedi');
    }
  }

  const total = sumMoney((expenses ?? []).map((e) => e.amount));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            from={from}
            to={to}
            onChange={({ from: f, to: t }) => {
              setFrom(f);
              setTo(t);
            }}
          />
          <BranchSelect value={branchId} onChange={setBranchId} />
        </div>
        <PermissionButton required={['finance.manage']} variant="primary" onClick={() => setShowNew(true)}>
          Yeni gider
        </PermissionButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!expenses || expenses.length === 0) && (
        <EmptyState title="Gider bulunamadı" description="Seçili filtrelere uyan gider kaydı yok." />
      )}
      {!loading && !error && expenses && expenses.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['Tarih', 'Kategori', 'Tutar', 'Not', 'Ekleyen', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {new Date(e.spentAt).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {e.category}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(e.amount)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {e.note ?? '-'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {e.createdByName ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <PermissionButton required={['finance.manage']} variant="danger" onClick={() => handleDelete(e.id)}>
                      Sil
                    </PermissionButton>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-right" style={{ color: 'var(--color-text-primary)' }}>
                  Toplam
                </td>
                <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {formatMoney(total)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showNew && activeStudioId && (
        <NewExpenseDialog
          studioId={activeStudioId}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
