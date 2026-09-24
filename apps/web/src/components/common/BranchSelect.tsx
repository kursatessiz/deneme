'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';

interface BranchRow {
  id: string;
  name: string;
  isActive: boolean;
}

const selectStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

/** A reusable branch filter dropdown, loaded from the studio's own branch list; "Tüm şubeler" means no branchId filter. */
export function BranchSelect({ value, onChange, className }: { value: string; onChange: (branchId: string) => void; className?: string }) {
  const { activeStudioId } = useDashboardSession();
  const { data: branches } = useBff<BranchRow[]>(`branches/studio/${activeStudioId}`, activeStudioId);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs px-2.5 py-1.5 ${className ?? ''}`}
      style={selectStyle}
    >
      <option value="">Tüm şubeler</option>
      {(branches ?? [])
        .filter((b) => b.isActive)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
    </select>
  );
}
