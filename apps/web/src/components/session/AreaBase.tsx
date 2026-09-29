'use client';

import { createContext, useCallback, useContext } from 'react';

/**
 * Base path of the shell a dashboard page is rendered in: '' in the tenant
 * dashboard, '/pazarlama' in the marketing panel (docs/PAZARLAMA_MODULU.md
 * 3.1). Reused pages build their in-app links with useAreaHref() so
 * `/kisiler/<id>` stays inside whichever shell the user is in.
 */
const AreaBaseContext = createContext<string>('');

export function AreaBaseProvider({ basePath, children }: { basePath: string; children: React.ReactNode }) {
  return <AreaBaseContext.Provider value={basePath}>{children}</AreaBaseContext.Provider>;
}

/** Pure form of useAreaHref, for tests and non-hook callers. Only app-internal absolute paths are prefixed. */
export function areaHref(basePath: string, path: string): string {
  if (!basePath || !path.startsWith('/') || path.startsWith('//')) return path;
  return `${basePath}${path}`;
}

export function useAreaHref(): (path: string) => string {
  const basePath = useContext(AreaBaseContext);
  return useCallback((path: string) => areaHref(basePath, path), [basePath]);
}
