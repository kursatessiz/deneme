import React from 'react';

import { Button } from './Button';
import type { ButtonProps } from './Button';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * Kept for the existing screens; a thin mapping onto Button. Primary is the
 * solid tenant color, secondary an outlined neutral, danger solid error.
 */
export function PrimaryButton({ label, onPress, disabled, loading, variant = 'primary' }: PrimaryButtonProps) {
  const mapped: Pick<ButtonProps, 'variant' | 'tone'> =
    variant === 'secondary'
      ? { variant: 'outline', tone: 'surface' }
      : variant === 'danger'
        ? { variant: 'solid', tone: 'error' }
        : { variant: 'solid', tone: 'theme' };
  return <Button label={label} onPress={onPress} disabled={disabled} loading={loading} {...mapped} />;
}
