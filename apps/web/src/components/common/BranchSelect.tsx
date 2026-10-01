'use client';

import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useBff } from '@/lib/session/use-bff';
import { useT } from '@/components/i18n/I18nProvider';
import { Select } from '@/components/ui/Select';

interface BranchRow {
  id: string;
  name: string;
  isActive: boolean;
}

/** A reusable branch filter dropdown, loaded from the studio's own branch list; "Tüm şubeler" means no branchId filter. */
export function BranchSelect({ value, onChange, className }: { value: string; onChange: (branchId: string) => void; className?: string }) {
  const { activeStudioId } = useDashboardSession();
  const { data: branches } = useBff<BranchRow[]>(`branches/studio/${activeStudioId}`, activeStudioId);
  const t = useT();

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{t('common.allBranches')}</option>
      {(branches ?? [])
        .filter((b) => b.isActive)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
    </Select>
  );
}
