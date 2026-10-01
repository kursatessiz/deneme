/**
 * Control styling of the pre-component-library screens. Only the events and
 * community screens (outside the CRM and marketing migration) still import
 * it, through components/growth/ui. New code uses Input, Select and Textarea
 * from components/ui; delete this file when those screens move over.
 */
import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export const inputClass = 'w-full text-sm px-3 py-2 outline-none';
