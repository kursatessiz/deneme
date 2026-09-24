'use client';

import { useEffect, useState } from 'react';
import { bffFetch, BffError } from '@/lib/session/client';

interface UseBffResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
}

/** Loads one BFF endpoint on mount, exposing loading/empty/error/forbidden states for a page to render around. */
export function useBff<T>(path: string | null, studioId: string | null): UseBffResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    bffFetch<T>(path, { studioId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof BffError && err.status === 403) setForbidden(true);
        else setError(err instanceof BffError ? err.message : 'Veriler yüklenemedi');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, studioId]);

  return { data, loading, error, forbidden };
}
