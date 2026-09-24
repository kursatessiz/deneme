'use client';

/**
 * Small presentational building blocks shared by the /ayarlar pages. Flat
 * surfaces with a hairline border only -- no nested cards, no gradients
 * outside the four allowed slots (CLAUDE.md rule 10). The primary button is
 * one of those slots.
 */

export function SettingsHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
        {description}
      </p>
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section
      className="p-5 border space-y-4"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-card)' }}
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </h3>
        {description && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: 'var(--gradient-brand)', color: 'var(--color-on-primary)', borderRadius: 'var(--radius-button)' }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-sm font-medium border disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        borderColor: danger ? 'var(--color-danger, #b42318)' : 'var(--color-border)',
        color: danger ? 'var(--color-danger, #b42318)' : 'var(--color-text-primary)',
        borderRadius: 'var(--radius-button)',
        backgroundColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border outline-none"
        style={{
          borderColor: error ? 'var(--color-danger, #b42318)' : 'var(--color-border)',
          borderRadius: 'var(--radius-input)',
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-text-primary)',
        }}
      />
      {error && (
        <span className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
          {error}
        </span>
      )}
    </label>
  );
}

export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative w-10 h-6 shrink-0 transition-colors"
        style={{ borderRadius: 'var(--radius-chip)', backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-surface-muted)' }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 bg-white transition-transform"
          style={{ borderRadius: 'var(--radius-chip)', transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </label>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'danger' }) {
  const bg = tone === 'primary' ? 'var(--color-primary)' : tone === 'danger' ? 'var(--color-danger, #b42318)' : 'var(--color-surface-muted)';
  const color = tone === 'neutral' ? 'var(--color-text-secondary)' : 'var(--color-on-primary, #fff)';
  return (
    <span className="inline-block px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: bg, color, borderRadius: 'var(--radius-chip)' }}>
      {children}
    </span>
  );
}

export function InlineMessage({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'success' | 'error' }) {
  const color = tone === 'success' ? 'var(--color-success, #2f7d4f)' : tone === 'error' ? 'var(--color-danger, #b42318)' : 'var(--color-text-muted)';
  return (
    <p className="text-xs" style={{ color }}>
      {text}
    </p>
  );
}
