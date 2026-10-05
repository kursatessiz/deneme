import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { DASHBOARD_GRID, getDashboardWidget, layoutsEqual } from '@platform/shared';
import type {
  DashboardDataResponseDTO,
  DashboardLayoutItem,
  DashboardLayoutResponseDTO,
  DashboardWidgetPayload,
} from '@platform/shared';

import { ApiError, apiRequest } from '../lib/api';
import { LAYOUT_SAVE_DELAY_MS } from '../lib/dashboardBoard';

export type BoardStatus = 'loading' | 'ready' | 'error' | 'forbidden';

export type WidgetDataState =
  | { status: 'loading' }
  | { status: 'ok'; data: DashboardWidgetPayload }
  | { status: 'forbidden' }
  | { status: 'error' };

export interface DashboardBoardState {
  items: DashboardLayoutItem[];
  status: BoardStatus;
  customized: boolean;
  /** Replaces the board at once and stores it shortly after (one PUT in flight at a time). */
  update: (next: DashboardLayoutItem[]) => void;
  /** Deletes the stored board and shows the permission based default again. */
  reset: () => Promise<void>;
  /** Reloads layout and figures (pull to refresh, retry). */
  reload: () => Promise<void>;
  dataOf: (item: DashboardLayoutItem) => WidgetDataState;
  /** True after a save failed and the board went back to the last stored version. */
  saveFailed: boolean;
  dismissSaveFailed: () => void;
}

/**
 * The membership's overview board on mobile: the same layout and data
 * endpoints as the web board. Edits are optimistic and saved with a
 * debounced PUT; a failed save rolls back to the last stored layout. A
 * pending save is flushed when the screen goes away or the app is sent to
 * the background.
 */
export function useDashboardBoard(studioId: string | null): DashboardBoardState {
  const [items, setItems] = useState<DashboardLayoutItem[]>([]);
  const [status, setStatus] = useState<BoardStatus>('loading');
  const [customized, setCustomized] = useState(false);
  const [data, setData] = useState<Record<string, WidgetDataState>>({});
  const [saveFailed, setSaveFailed] = useState(false);

  const committed = useRef<DashboardLayoutItem[]>([]);
  const pending = useRef<DashboardLayoutItem[] | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);

  const loadData = useCallback(
    async (id: string, boardItems: readonly DashboardLayoutItem[]) => {
      const requested = boardItems.filter((item) => !getDashboardWidget(item.widget).clientOnly);
      if (requested.length === 0) return;
      try {
        const res = await apiRequest<DashboardDataResponseDTO>(`/studios/${id}/dashboard/data`, {
          method: 'POST',
          studioId: id,
          body: { widgets: requested.map((item) => ({ id: item.id, widget: item.widget, ...(item.settings ? { settings: item.settings } : {}) })) },
        });
        if (!mounted.current) return;
        const next: Record<string, WidgetDataState> = {};
        for (const result of res.results) {
          next[result.id] = result.status === 'ok' ? { status: 'ok', data: result.data } : { status: result.status };
        }
        setData(next);
      } catch {
        if (!mounted.current) return;
        const failed: Record<string, WidgetDataState> = {};
        for (const item of requested) failed[item.id] = { status: 'error' };
        setData(failed);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    if (!studioId) return;
    try {
      const res = await apiRequest<DashboardLayoutResponseDTO>(`/studios/${studioId}/dashboard/layout`, { studioId });
      if (!mounted.current) return;
      committed.current = res.layout.items;
      setItems(res.layout.items);
      setCustomized(res.customized);
      setStatus('ready');
      await loadData(studioId, res.layout.items);
    } catch (error) {
      if (!mounted.current) return;
      setStatus(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }, [studioId, loadData]);

  useEffect(() => {
    mounted.current = true;
    setStatus('loading');
    setData({});
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!studioId || inFlight.current || !pending.current) return;
    const next = pending.current;
    pending.current = null;
    inFlight.current = true;
    const myRevision = revision.current;
    try {
      const res = await apiRequest<DashboardLayoutResponseDTO>(`/studios/${studioId}/dashboard/layout`, {
        method: 'PUT',
        studioId,
        body: { version: DASHBOARD_GRID.version, items: next },
      });
      committed.current = res.layout.items;
      if (!mounted.current) return;
      setCustomized(true);
      // The server may have normalized the board; adopt it unless the user edited again meanwhile.
      if (revision.current === myRevision && !layoutsEqual(res.layout.items, next)) setItems(res.layout.items);
    } catch {
      if (mounted.current && revision.current === myRevision) {
        setItems(committed.current);
        setSaveFailed(true);
      }
    } finally {
      inFlight.current = false;
      // An edit made while this save ran is stored right after it.
      if (pending.current) void flush();
    }
  }, [studioId]);

  const update = useCallback(
    (next: DashboardLayoutItem[]) => {
      revision.current += 1;
      setItems(next);
      setSaveFailed(false);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), LAYOUT_SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      sub.remove();
      void flush();
    };
  }, [flush]);

  const reset = useCallback(async () => {
    if (!studioId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    revision.current += 1;
    try {
      const res = await apiRequest<DashboardLayoutResponseDTO>(`/studios/${studioId}/dashboard/layout`, { method: 'DELETE', studioId });
      committed.current = res.layout.items;
      setItems(res.layout.items);
      setCustomized(false);
      await loadData(studioId, res.layout.items);
    } catch {
      setItems(committed.current);
      setSaveFailed(true);
    }
  }, [studioId, loadData]);

  const dataOf = useCallback((item: DashboardLayoutItem): WidgetDataState => data[item.id] ?? { status: 'loading' }, [data]);
  const dismissSaveFailed = useCallback(() => setSaveFailed(false), []);

  return { items, status, customized, update, reset, reload: load, dataOf, saveFailed, dismissSaveFailed };
}
