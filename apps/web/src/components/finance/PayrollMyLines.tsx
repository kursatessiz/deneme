'use client';

import type { PayrollLineDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { formatMoney, sumMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';

type MyPayrollLine = PayrollLineDTO;

/** A trainer who only has commissions.view.own sees their own approved/paid lines instead of the full run list. */
export function PayrollMyLines() {
  const { activeStudioId } = useDashboardSession();
  const { data: lines, loading, error } = useBff<MyPayrollLine[]>(`payroll/studio/${activeStudioId}/me/lines`, activeStudioId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Hakedişlerim
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Onaylanmış ve ödenmiş bordro dönemlerindeki hakediş satırlarınız
        </p>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!lines || lines.length === 0) && <EmptyState title="Henüz hakediş kaydı yok" />}
      {!loading && !error && lines && lines.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {['Seans', 'Katılımcı', 'Brüt', 'Düzeltme', 'Net'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {l.sessions}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {l.attendees}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatMoney(l.grossAmount)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatMoney(l.adjustments)}
                  </td>
                  <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(l.netAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                <td colSpan={4} className="px-4 py-2.5 font-semibold text-right" style={{ color: 'var(--color-text-primary)' }}>
                  Toplam net
                </td>
                <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {formatMoney(sumMoney(lines.map((l) => l.netAmount)))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
