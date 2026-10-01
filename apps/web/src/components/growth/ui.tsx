'use client';

import { useLocale } from '@/components/i18n/I18nProvider';
import { PageHeader as UiPageHeader } from '@/components/ui/PageHeader';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <UiPageHeader title={title} description={subtitle} actions={actions} />;
}

/** One flat bordered section; never nested inside another panel. */
export function Panel({ title, actions, children, labelledBy }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className="pui-card">
      <div className="pui-card-content">
        {(title || actions) && (
          <div className="flex items-center justify-between gap-2">
            {title && (
              <h3 id={labelledBy} className="ui-heading">
                {title}
              </h3>
            )}
            {actions}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="pui-field-group">
      <label htmlFor={htmlFor} className="ui-small">
        {label}
      </label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="ui-caption">{children}</p>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  const toneClass = tone === 'error' ? 'ui-text-error' : tone === 'success' ? 'ui-text-success' : '';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={toneClass ? `ui-caption ${toneClass}` : 'ui-caption'}>
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
