import { cx } from './types';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** A pulsing placeholder block while data loads. */
export function Skeleton({ width = '100%', height = '1rem', className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx('ui-skeleton block', className)} style={{ width, height }} />;
}
