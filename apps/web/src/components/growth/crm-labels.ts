import type { Translate } from '@platform/shared';

/** Tenant-named stages show their own name; built-in stages show the translated label (crm.stage.<key>). */
export function stageLabel(stage: { key: string; name: string | null }, t: Translate): string {
  if (stage.name) return stage.name;
  const label = t(`crm.stage.${stage.key}`);
  return label === `crm.stage.${stage.key}` ? stage.key : label;
}
