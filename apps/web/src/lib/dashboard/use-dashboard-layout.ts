'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DASHBOARD_GRID, layoutsEqual } from '@platform/shared';
import type { DashboardLayoutItem, DashboardLayoutResponseDTO } from '@platform/shared';
import { bffFetch } from '@/lib/session/client';

/** Delay between the last edit and the PUT that stores it. */
export const LAYOUT_SAVE_DELAY_MS = 800;

export type LayoutStatus = 'loading' | 'ready' | 'error' | 'forbidden';

export interface DashboardLayoutState {
  items: DashboardLayoutItem[];
  status: LayoutStatus;
  customized: boolean;
  saving: boolean;
  /** Replaces the board optimistically and schedules a save. */
  update: (next: DashboardLayoutItem[]) => void;
  /** Deletes the stored board and shows the default again. */
  reset: () => Promise<void>;
  reload: () => void;
}

/**
 * The membership's overview board: loads it from the API, applies edits
 * at once (optimistic) and stores them with a debounced PUT. A failed save
 * rolls the board back to the last stored version and reports through
 * `onSaveError`. A pending save is flushed (keepalive) when the page goes.
 */
export function useDashboardLayout(studioId: string, onSaveError: () => void): DashboardLayoutState {
  const [items, setItems] = useState<DashboardLayoutItem[]>([]);
  const [status, setStatus] = useState<LayoutStatus>('loading');
  const [customized, setCustomized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const committed = useRef<DashboardLayoutItem[]>([]);
  const pending = useRef<DashboardLayoutItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revision = useRef(0);
  const onErrorRef = useRef(onSaveError);
  onErrorRef.current = onSaveError;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    bffFetch<DashboardLayoutResponseDTO>(`studios/${studioId}/dashboard/layout`, { studioId })
      .then((res) => {
        if (cancelled) return;
        committed.current = res.layout.items;
        setItems(res.layout.items);
        setCustomized(res.customized);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const forbidden = typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 403;
        setStatus(forbidden ? 'forbidden' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [studioId, reloadKey]);

  const save = useCallback(
    async (next: DashboardLayoutItem[], keepalive = false) => {
      const myRevision = revision.current;
      setSaving(true);
      try {
        const res = await bffFetch<DashboardLayoutResponseDTO>(`studios/${studioId}/dashboard/layout`, {
          method: 'PUT',
          studioId,
          keepalive,
          body: { version: DASHBOARD_GRID.version, items: next },
        });
        committed.current = res.layout.items;
        setCustomized(true);
        // The server may have normalized the board; adopt it unless the user edited again meanwhile.
        if (revision.current === myRevision && !layoutsEqual(res.layout.items, next)) setItems(res.layout.items);
      } catch {
        if (revision.current === myRevision) setItems(committed.current);
        onErrorRef.current();
      } finally {
        setSaving(false);
      }
    },
    [studioId],
  );

  const flush = useCallback(
    (keepalive: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next) void save(next, keepalive);
    },
    [save],
  );

  const update = useCallback(
    (next: DashboardLayoutItem[]) => {
      revision.current += 1;
      setItems(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(false), LAYOUT_SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
  }, [flush]);

  const reset = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    revision.current += 1;
    setSaving(true);
    try {
      const res = await bffFetch<DashboardLayoutResponseDTO>(`studios/${studioId}/dashboard/layout`, { method: 'DELETE', studioId });
      committed.current = res.layout.items;
      setItems(res.layout.items);
      setCustomized(false);
    } catch {
      setItems(committed.current);
      onErrorRef.current();
    } finally {
      setSaving(false);
    }
  }, [studioId]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { items, status, customized, saving, update, reset, reload };
}
