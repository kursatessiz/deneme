'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getDashboardWidget } from '@platform/shared';
import type { DashboardDataResponseDTO, DashboardLayoutItem, DashboardWidgetPayload } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';
import { distinctDataRequests, widgetDataKey } from './grid-math';

export type WidgetDataState =
  | { status: 'loading' }
  | { status: 'ok'; data: DashboardWidgetPayload }
  | { status: 'forbidden' }
  | { status: 'error' };

/** How long a card's figures are reused before the board asks again (the API caches for 45 s too). */
const STALE_AFTER_MS = 5 * 60 * 1000;

interface Entry {
  state: WidgetDataState;
  at: number;
}

/**
 * Figures for every card on the board in one POST per change: only cards
 * whose (card, period, branch) has no fresh result are requested, so
 * moving or resizing never refetches and changing one card's period asks
 * for that card alone. Client-only cards (quick actions) are skipped.
 */
export function useDashboardData(
  studioId: string,
  items: readonly DashboardLayoutItem[],
  branchId: string | null,
  enabled: boolean,
): { get: (item: DashboardLayoutItem) => WidgetDataState; retry: (item: DashboardLayoutItem) => void } {
  const cache = useRef(new Map<string, Entry>());
  const inFlight = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);

  const requests = useMemo(
    () => distinctDataRequests(items, branchId, (widget) => getDashboardWidget(widget).clientOnly === true),
    [items, branchId],
  );

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const missing = requests.filter(({ key }) => {
      if (inFlight.current.has(key)) return false;
      const entry = cache.current.get(key);
      return !entry || entry.state.status === 'error' || now - entry.at > STALE_AFTER_MS;
    });
    if (missing.length === 0) return;
    for (const { key } of missing) inFlight.current.add(key);
    const byId = new Map(missing.map(({ key, item }) => [item.id, key]));
    bffFetch<DashboardDataResponseDTO>(`studios/${studioId}/dashboard/data`, {
      method: 'POST',
      studioId,
      body: {
        ...(branchId ? { branchId } : {}),
        widgets: missing.map(({ item }) => ({ id: item.id, widget: item.widget, ...(item.settings ? { settings: item.settings } : {}) })),
      },
    })
      .then((res) => {
        const at = Date.now();
        for (const result of res.results) {
          const key = byId.get(result.id);
          if (!key) continue;
          cache.current.set(key, { at, state: result.status === 'ok' ? { status: 'ok', data: result.data } : { status: result.status } });
        }
      })
      .catch(() => {
        const at = Date.now();
        for (const { key } of missing) cache.current.set(key, { at, state: { status: 'error' } });
      })
      .finally(() => {
        for (const { key } of missing) inFlight.current.delete(key);
        setVersion((v) => v + 1);
      });
  }, [requests, studioId, branchId, enabled, tick]);

  // Look again now and then so a board left open does not show stale figures for long.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), STALE_AFTER_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () => ({
      get: (item: DashboardLayoutItem): WidgetDataState => cache.current.get(widgetDataKey(item.widget, item.settings, branchId))?.state ?? { status: 'loading' },
      retry: (item: DashboardLayoutItem) => {
        cache.current.delete(widgetDataKey(item.widget, item.settings, branchId));
        setTick((t) => t + 1);
      },
    }),
    // version: a finished request changes what `get` returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchId, version],
  );
}
