import { cx, look } from './types';
import type { UiTone } from './types';

export interface AvatarProps {
  /** Full name; the initials are its first two words' first letters. */
  name: string;
  src?: string | null;
  tone?: UiTone;
  className?: string;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase();
}

/** 32px round avatar: the image when there is one, otherwise the initials on the brand color. */
export function Avatar({ name, src, tone = 'theme', className }: AvatarProps) {
  return (
    <span className={cx('ui-avatar', look('solid', tone), className)} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant or user image on an arbitrary host
        <img src={src} alt="" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
