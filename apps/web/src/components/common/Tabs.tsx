'use client';

import { Tabs as UiTabs } from '@/components/ui/Tabs';

export interface TabDef {
  key: string;
  label: string;
}

/** Tab strip used to split a page (finance, reports) into sections without nested cards. */
export function Tabs({ tabs, active, onChange }: { tabs: readonly TabDef[]; active: string; onChange: (key: string) => void }) {
  return <UiTabs tabs={tabs} active={active} onChange={onChange} />;
}
