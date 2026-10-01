import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';

/**
 * Perfect UI's three-class rule: every element is a shape (`pui-btn`,
 * `pui-card`...), a style and a color role. These are the style and color
 * vocabularies; components turn them into classes so screens never write
 * colors themselves.
 */
export type UiVariant = 'solid' | 'soft' | 'outline' | 'link';
export type UiTone = 'theme' | 'success' | 'warn' | 'error' | 'muted' | 'surface' | 'inverse';
export type UiSize = 'sm' | 'md';

export function cx(...values: ClassValue[]): string {
  return clsx(values);
}

/** Style and color classes of the kit, e.g. `pui-soft pui-success`. */
export function look(variant: UiVariant, tone: UiTone): string {
  return `pui-${variant} pui-${tone}`;
}

/**
 * Inline style that ties a popover to its trigger with CSS anchor
 * positioning (the kit's dropdown and tooltip use `position-area`). React's
 * style typings do not list the anchor properties yet, hence the cast of a
 * plain string record.
 */
export function anchorStyle(kind: 'anchor' | 'target', name: string): React.CSSProperties {
  const record: Record<string, string> = kind === 'anchor' ? { anchorName: name } : { positionAnchor: name };
  return record as React.CSSProperties;
}

/** A CSS dashed ident built from React's useId() (which contains colons). */
export function anchorName(id: string): string {
  return `--ui-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
