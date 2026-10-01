import type { ReactNode } from 'react';
import { Card, CardContent, cx } from '@/components/ui';

/**
 * Page frame of the small public screens (unsubscribe, double opt-in, shared
 * post): the kit's page color, one centered card. `wide` is for reading
 * content and sits at the top instead of the middle.
 */
export function PublicShell({ wide = false, as = 'div', children }: { wide?: boolean; as?: 'div' | 'article'; children: ReactNode }) {
  return (
    <main className={cx('min-h-screen flex justify-center px-4 py-12', !wide && 'items-center')}>
      <Card as={as} className={cx('w-full h-fit', wide ? 'max-w-2xl' : 'max-w-md')}>
        <CardContent className="gap-5 p-6">{children}</CardContent>
      </Card>
    </main>
  );
}
