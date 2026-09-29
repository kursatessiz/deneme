import type { CSSProperties } from 'react';

/** Form control look shared by the store screens; design tokens only. */
export const fieldStyle: CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export const fieldClass = 'w-full text-sm px-3 py-1.5';

export const labelStyle: CSSProperties = { color: 'var(--color-text-secondary)' };

export const tableWrapStyle: CSSProperties = { borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' };

export const headRowStyle: CSSProperties = { backgroundColor: 'var(--color-surface-muted)' };

export const rowStyle: CSSProperties = { borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' };

export const sectionStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  backgroundColor: 'var(--color-surface)',
};
