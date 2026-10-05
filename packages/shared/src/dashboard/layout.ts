import { z } from 'zod';
import { DASHBOARD_GRID } from './grid';
import { DashboardWidgetKeySchema, DashboardWidgetSettingsSchema, getDashboardWidget, isDashboardWidgetKey } from './widgets';
import type { DashboardWidgetKey, DashboardWidgetSettings } from './widgets';

/**
 * One card on the board, in the 12 column grid: `x`/`w` are columns,
 * `y`/`h` rows. Positions are integers; the server re-clamps sizes to the
 * card's limits and re-compacts the board before storing it, so a client
 * never has to send a perfectly packed layout.
 */
export const DashboardLayoutItemSchema = z
  .object({
    id: z.string().uuid(),
    widget: DashboardWidgetKeySchema,
    x: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
    y: z.number().int().min(0).max(DASHBOARD_GRID.maxY),
    w: z.number().int().min(1).max(DASHBOARD_GRID.columns),
    h: z.number().int().min(1).max(DASHBOARD_GRID.columns),
    settings: DashboardWidgetSettingsSchema.optional(),
  })
  .strict();

export interface DashboardLayoutItem {
  id: string;
  widget: DashboardWidgetKey;
  x: number;
  y: number;
  w: number;
  h: number;
  settings?: DashboardWidgetSettings;
}

export const DashboardLayoutSchema = z
  .object({
    version: z.literal(DASHBOARD_GRID.version),
    items: z.array(DashboardLayoutItemSchema).max(DASHBOARD_GRID.maxItems),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const ids = new Set<string>();
    const singletons = new Set<DashboardWidgetKey>();
    layout.items.forEach((item, index) => {
      if (item.x + item.w > DASHBOARD_GRID.columns) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Kart ızgaranın dışına taşıyor', path: ['items', index, 'w'] });
      }
      if (ids.has(item.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Kart kimliği tekrar ediyor', path: ['items', index, 'id'] });
      }
      ids.add(item.id);
      // An unknown key is already reported by the item schema; superRefine still runs after non-fatal issues.
      if (!isDashboardWidgetKey(item.widget)) return;
      const definition = getDashboardWidget(item.widget);
      if (definition.singleton) {
        if (singletons.has(item.widget)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bu kart panoda yalnızca bir kez yer alabilir', path: ['items', index, 'widget'] });
        }
        singletons.add(item.widget);
      }
      if (item.settings !== undefined) {
        if (!definition.settings) {
          if (Object.keys(item.settings).length > 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bu kartın ayarı yok', path: ['items', index, 'settings'] });
          }
        } else if (!definition.settings.schema.safeParse(item.settings).success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bu kart için geçersiz dönem', path: ['items', index, 'settings', 'period'] });
        }
      }
    });
  });

export interface DashboardLayout {
  version: typeof DASHBOARD_GRID.version;
  items: DashboardLayoutItem[];
}

/** What GET/PUT/DELETE `/studios/:studioId/dashboard/layout` return. */
export interface DashboardLayoutResponseDTO {
  layout: DashboardLayout;
  /** False while the board is the permission based default (nothing stored yet, or after a reset). */
  customized: boolean;
  updatedAt: string | null;
}
