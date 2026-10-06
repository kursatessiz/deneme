'use client';

import { useEffect, useState } from 'react';
import type { ExpenseDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { buildReportQuery } from '@/lib/reports/query';
import { formatMoney, sumMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Modal } from '@/components/common/Modal';
import { BranchSelect } from '@/components/common/BranchSelect';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';
import { useConfirm, useToast } from '@/components/ui';

type ExpenseRow = ExpenseDTO;

function NewExpenseDialog({ studioId, onClose, onDone }: { studioId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
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
      setError(t('finance.expenses.validation'));
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
      setError(err instanceof BffError ? err.message : t('finance.expenses.errors.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('finance.expenses.newTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input placeholder={t('finance.expenses.categoryPlaceholder')} value={category} onChange={(e) => setCategory(e.target.value)} className="w-full" />
        <Input
          type="number"
          min="0.01"
          step="0.01"
          placeholder={t('finance.expenses.amountPlaceholder')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full"
        />
        <Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="w-full" />
        <Textarea placeholder={t('finance.expenses.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
        {error && <p className="ui-caption ui-text-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['finance.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('finance.expenses.saving') : t('common.save')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

export function ExpensesTab() {
  const t = useT();
  const { confirm } = useConfirm();
  const toast = useToast();
  const formatMoney = useFormatMoney();
  const locale = useLocale();
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
      .catch((err) => setError(err instanceof BffError ? err.message : t('finance.expenses.errors.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudioId, branchId, from, to, reloadKey]);

  async function handleDelete(id: string) {
    if (!activeStudioId) return;
    if (!(await confirm({ message: t('finance.expenses.confirmDelete'), danger: true }))) return;
    try {
      await bffFetch(`expenses/${id}/studio/${activeStudioId}`, { method: 'DELETE', studioId: activeStudioId });
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof BffError ? err.message : t('finance.expenses.errors.deleteFailed'));
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
            onChange={({ from: f, to: t2 }) => {
              setFrom(f);
              setTo(t2);
            }}
          />
          <BranchSelect value={branchId} onChange={setBranchId} />
        </div>
        <PermissionButton required={['finance.manage']} variant="primary" onClick={() => setShowNew(true)}>
          {t('finance.expenses.new')}
        </PermissionButton>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!expenses || expenses.length === 0) && (
        <EmptyState title={t('finance.expenses.empty.title')} description={t('finance.expenses.empty.description')} />
      )}
      {!loading && !error && expenses && expenses.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('finance.expenses.col.date'),
                  t('finance.expenses.col.category'),
                  t('finance.expenses.col.amount'),
                  t('finance.expenses.col.note'),
                  t('finance.expenses.col.addedBy'),
                  '',
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {expenses.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap">{new Date(e.spentAt).toLocaleDateString(locale)}</Td>
                  <Td>{e.category}</Td>
                  <Td className="ui-strong">{formatMoney(e.amount)}</Td>
                  <Td>{e.note ?? '-'}</Td>
                  <Td>{e.createdByName ?? '-'}</Td>
                  <Td className="text-right">
                    <PermissionButton required={['finance.manage']} variant="danger" onClick={() => handleDelete(e.id)}>
                      {t('common.delete')}
                    </PermissionButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
            <tfoot>
              <Tr>
                <Td colSpan={2} className="ui-strong text-right">
                  {t('finance.expenses.total')}
                </Td>
                <Td className="ui-strong">{formatMoney(total)}</Td>
                <Td colSpan={3} />
              </Tr>
            </tfoot>
          </Table>
        </Card>
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
