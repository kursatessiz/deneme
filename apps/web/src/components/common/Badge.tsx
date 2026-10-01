import { Badge as UiBadge } from '@/components/ui/Badge';
import type { UiTone } from '@/components/ui/types';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<Tone, UiTone> = {
  neutral: 'muted',
  success: 'success',
  warning: 'warn',
  danger: 'error',
  info: 'theme',
};

/** Status label kept for existing call sites; draws `pui-badge pui-soft <role>`. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <UiBadge tone={TONE[tone]}>{children}</UiBadge>;
}
