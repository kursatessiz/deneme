import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { normalizeRoute } from '@platform/shared';

import { useSession } from '../lib/session';
import { addBreadcrumb, setErrorRoute, setErrorStudio } from './runtime';

/**
 * Feeds the error reporter with what only React knows (H2): the current
 * screen (navigation breadcrumbs and the `route` of reported errors, ids
 * replaced) and the active studio (sent with error batches, verified by the
 * API against the membership). Renders nothing. Must sit inside
 * SessionProvider and below the Expo Router root.
 */
export function ErrorTelemetry(): null {
  const pathname = usePathname();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId ?? null;

  useEffect(() => {
    setErrorStudio(studioId);
  }, [studioId]);

  useEffect(() => {
    const route = normalizeRoute(pathname || '/');
    setErrorRoute(route);
    addBreadcrumb('navigation', route);
  }, [pathname]);

  return null;
}
