type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-muted)', fg: 'var(--color-text-secondary)' },
  success: { bg: 'rgba(22, 163, 74, 0.12)', fg: '#15803d' },
  warning: { bg: 'rgba(217, 119, 6, 0.14)', fg: '#b45309' },
  danger: { bg: 'rgba(220, 38, 38, 0.12)', fg: '#b42318' },
  info: { bg: 'rgba(37, 99, 235, 0.12)', fg: '#1d4ed8' },
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  const colors = TONE_COLORS[tone];
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium px-2 py-0.5"
      style={{ backgroundColor: colors.bg, color: colors.fg, borderRadius: 'var(--radius-chip)' }}
    >
      {children}
    </span>
  );
}
