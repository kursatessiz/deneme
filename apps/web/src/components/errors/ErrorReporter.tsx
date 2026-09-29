'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { normalizeRoute } from '@platform/shared';
import { addBreadcrumb, configureErrorReporter, reportError } from '@/lib/errors/reporter';

/** A short, non-identifying description of a clicked element: tag, role and its accessible label. */
function describeTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], input[type="submit"], summary') ?? target;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  // Never the value of a field, and never link text (it often is a person's
  // name): a button's own label, or a link's target route with ids removed.
  const href = tag === 'a' ? el.getAttribute('href') : null;
  const label =
    el.getAttribute('aria-label') ??
    (tag === 'button' ? (el.textContent ?? '').trim().slice(0, 40) : href && href.startsWith('/') ? normalizeRoute(href) : '');
  return `${tag}${role ? `[${role}]` : ''}${label ? ` ${label.slice(0, 60)}` : ''}`;
}

/**
 * Mounted once in the root layout: configures the reporter with this
 * build's release, records navigation and click breadcrumbs and reports
 * uncaught errors and unhandled promise rejections. No inline script: it
 * is a regular client component, so it runs under the nonce CSP.
 */
export function ErrorReporter({ release, environment }: { release: string; environment: string }) {
  const pathname = usePathname();

  useEffect(() => {
    configureErrorReporter({ release, environment });
    const onError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message, { severity: 'error' });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason, { severity: 'error' });
    };
    const onClick = (event: MouseEvent) => {
      const description = describeTarget(event.target);
      if (description) addBreadcrumb('click', description);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('click', onClick, { capture: true, passive: true });
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('click', onClick, { capture: true });
    };
  }, [release, environment]);

  useEffect(() => {
    if (pathname) addBreadcrumb('navigation', normalizeRoute(pathname));
  }, [pathname]);

  return null;
}
