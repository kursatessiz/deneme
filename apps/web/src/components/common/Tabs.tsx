'use client';

export interface TabDef {
  key: string;
  label: string;
}

/** Simple, dependency-free tab strip used to split a page (finance, reports) into sections without nested cards. */
export function Tabs({ tabs, active, onChange }: { tabs: readonly TabDef[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="text-sm font-medium px-3 py-2 whitespace-nowrap border-b-2 -mb-px transition-colors"
            style={{
              borderColor: isActive ? 'var(--color-primary)' : 'transparent',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
