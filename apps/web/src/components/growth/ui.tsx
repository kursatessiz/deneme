'use client';

import { useLocale } from '@/components/i18n/I18nProvider';

/** Form control style shared by the CRM, segment, campaign and journey screens (design tokens only). */
export const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

export const inputClass = 'w-full text-sm px-3 py-2 outline-none';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** One flat bordered section; never nested inside another panel. */
export function Panel({ title, actions, children, labelledBy }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; labelledBy?: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="p-4 space-y-3"
      style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2">
          {title && (
            <h3 id={labelledBy} className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {title}
            </h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {children}
    </p>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  const color = tone === 'error' ? 'var(--color-danger, #b42318)' : tone === 'success' ? 'var(--color-success, #15803d)' : 'var(--color-text-secondary)';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className="text-xs" style={{ color }}>
      {children}
    </p>
  );
}

/** Date and date-time formatting in the viewer's language (never a fixed locale). */
export function useDateFormat() {
  const locale = useLocale();
  return {
    date: (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : ''),
    dateTime: (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : ''),
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
  };
}

/** Readable message out of a BFF error (API validation errors carry an `errors` list). */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
