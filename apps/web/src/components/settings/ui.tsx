'use client';

/**
 * Small building blocks shared by the /ayarlar pages, on top of the
 * component library (docs/TASARIM.md). Flat cards with a hairline border,
 * no nested cards, no gradients (only member and package cards carry one).
 */

import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Badge as UiBadge } from '@/components/ui/Badge';

export function SettingsHeader({ title, description }: { title: string; description: string }) {
  return <PageHeader title={title} description={description} />;
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="pui-card">
      <div className="pui-card-content gap-4">
        <div className="grid gap-1">
          <h3 className="ui-heading">{title}</h3>
          {description && <p className="ui-caption">{description}</p>}
        </div>
        {children}
      </div>
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
    <Button type={type} onClick={onClick} disabled={disabled} className="justify-self-start">
      {children}
    </Button>
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
    <Button variant="outline" tone={danger ? 'error' : 'surface'} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
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
    <FieldGroup label={label} error={error ?? undefined}>
      <Input type={type} value={value} placeholder={placeholder} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
    </FieldGroup>
  );
}

export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'danger' }) {
  if (tone === 'primary')
    return (
      <UiBadge variant="solid" tone="theme">
        {children}
      </UiBadge>
    );
  if (tone === 'danger')
    return (
      <UiBadge variant="solid" tone="error">
        {children}
      </UiBadge>
    );
  return <UiBadge>{children}</UiBadge>;
}

export function InlineMessage({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'success' | 'error' }) {
  const toneClass = tone === 'success' ? 'ui-text-success' : tone === 'error' ? 'ui-text-error' : '';
  return <p className={toneClass ? `ui-caption ${toneClass}` : 'ui-caption'}>{text}</p>;
}
