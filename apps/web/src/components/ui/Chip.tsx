import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import { cx, look } from './types';
import type { UiTone, UiVariant } from './types';

interface ChipLook {
  variant?: UiVariant;
  tone?: UiTone;
}

/** `pui-chip` as a pill: tags, sectors, filters. */
export function Chip({ variant = 'outline', tone = 'surface', className, ...rest }: ChipLook & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('pui-chip pui-rounded-full', look(variant, tone), className)} {...rest} />;
}

/** A toggleable chip (filter); `selected` switches it to the soft brand look. */
export function ChipButton({
  selected = false,
  className,
  type = 'button',
  ...rest
}: { selected?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx('pui-chip pui-rounded-full', selected ? look('soft', 'theme') : look('outline', 'surface'), className)}
      {...rest}
    />
  );
}
