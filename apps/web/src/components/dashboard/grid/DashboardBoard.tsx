'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, MoreVertical, Pencil, Plus, RotateCcw } from 'lucide-react';
import { DASHBOARD_GRID, getDashboardWidget, placeNewItem, removeItem, restoreItem } from '@platform/shared';
import type { DashboardLayoutItem, DashboardWidgetKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useDashboardColumns, usePrefersReducedMotion } from '@/lib/dashboard/use-dashboard-columns';
import { useDashboardData } from '@/lib/dashboard/use-dashboard-data';
import { useDashboardLayout } from '@/lib/dashboard/use-dashboard-layout';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Float, Toast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/common/DataState';
import { AddCardDialog } from './AddCardDialog';
import { DashboardGrid } from './DashboardGrid';

/** How long the undo toast stays after a card is removed. */
const UNDO_WINDOW_MS = 6000;

function newId(): string {
  return crypto.randomUUID();
}

/**
 * The overview page: header with "Kart ekle", the edit toggle and the
 * overflow menu ("Varsayılana dön"), then the card grid. Edits apply at
 * once and are saved shortly after; a failed save rolls back with a toast.
 */
export function DashboardBoard() {
  const t = useT();
  const { activeStudioId, permissions, isOwner, activeBranchId } = useDashboardSession();
  const columns = useDashboardColumns();
  const reducedMotion = usePrefersReducedMotion();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removing, setRemoving] = useState<DashboardLayoutItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<DashboardLayoutItem | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const scrollTo = useRef<string | null>(null);

  const onSaveError = useCallback(() => setToast(t('dashboard.toast.saveFailed')), [t]);
  const layout = useDashboardLayout(activeStudioId, onSaveError);
  const data = useDashboardData(activeStudioId, layout.items, activeBranchId ?? null, layout.status === 'ready');

  const announce = useCallback((message: string) => {
    // Re-setting the same text would not be read again; clear first.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [undo]);

  // After adding a card, bring it into view and give it focus.
  useEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    const element = document.getElementById(`dash-card-${id}`);
    if (!element) return;
    scrollTo.current = null;
    element.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    if (element.tabIndex >= 0) element.focus({ preventScroll: true });
  }, [layout.items, reducedMotion]);

  const addCard = (widget: DashboardWidgetKey) => {
    const definition = getDashboardWidget(widget);
    const item = placeNewItem(layout.items, widget, newId(), definition.settings ? { period: definition.settings.defaultPeriod } : undefined);
    scrollTo.current = item.id;
    layout.update([...layout.items, item]);
    setAdding(false);
    announce(t('dashboard.announce.added', { title: t(definition.titleKey), column: item.x + 1, row: item.y + 1 }));
  };

  /** Removes a card (optimistic, saved with the debounced PUT) and offers an undo for a few seconds. */
  const removeCard = (item: DashboardLayoutItem) => {
    const title = t(getDashboardWidget(item.widget).titleKey);
    layout.update(removeItem(layout.items, item.id));
    setUndo(item);
    announce(t('dashboard.announce.removed', { title }));
  };

  const confirmRemove = () => {
    if (!removing) return;
    removeCard(removing);
    setRemoving(null);
  };

  const undoRemove = () => {
    if (!undo) return;
    const title = t(getDashboardWidget(undo.widget).titleKey);
    layout.update(restoreItem(layout.items, undo));
    setUndo(null);
    announce(t('dashboard.announce.restored', { title }));
  };

  const doReset = async () => {
    setConfirmReset(false);
    await layout.reset();
    announce(t('dashboard.announce.reset'));
  };

  const actions = (
    <>
      <Button icon={<Plus className="ui-icon" aria-hidden="true" />} onClick={() => setAdding(true)} disabled={layout.status !== 'ready'}>
        {t('dashboard.actions.addCard')}
      </Button>
      <Button
        variant="outline"
        tone="surface"
        aria-pressed={editing}
        icon={editing ? <Check className="ui-icon" aria-hidden="true" /> : <Pencil className="ui-icon" aria-hidden="true" />}
        onClick={() => {
          setEditing((e) => !e);
          announce(editing ? t('dashboard.announce.editOff') : t('dashboard.announce.editOn'));
        }}
        disabled={layout.status !== 'ready'}
      >
        {editing ? t('dashboard.actions.done') : t('dashboard.actions.edit')}
      </Button>
      <Dropdown label={<MoreVertical className="ui-icon" aria-hidden="true" />} ariaLabel={t('dashboard.actions.more')} iconOnly align="end">
        <DropdownItem onClick={() => setConfirmReset(true)} disabled={!layout.customized || layout.status !== 'ready'}>
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="ui-icon" aria-hidden="true" />
            {t('dashboard.actions.reset')}
          </span>
        </DropdownItem>
      </Dropdown>
    </>
  );

  return (
    <div className="grid gap-6 min-w-0">
      <PageHeader title={t('screens.dashboard.title')} description={t('screens.dashboard.subtitle')} actions={layout.status === 'forbidden' ? undefined : actions} />

      {editing ? (
        <p className="ui-panel ui-small" role="note">
          {columns === DASHBOARD_GRID.columns ? t('dashboard.edit.hint') : t('dashboard.edit.hintNarrow')}
        </p>
      ) : null}

      {layout.status === 'loading' ? (
        <div className="ui-dash-grid" aria-busy="true" style={{ '--ui-dash-cols': String(Math.min(columns, 4)) } as React.CSSProperties}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={`${DASHBOARD_GRID.rowHeight * 2 + DASHBOARD_GRID.gap}px`} />
          ))}
        </div>
      ) : null}
      {layout.status === 'error' ? (
        <div className="grid gap-2 justify-items-start">
          <ErrorState message={t('dashboard.state.layoutError')} />
          <Button size="sm" variant="outline" tone="surface" onClick={layout.reload}>
            {t('dashboard.state.retry')}
          </Button>
        </div>
      ) : null}
      {layout.status === 'forbidden' ? <EmptyState title={t('dashboard.state.noAccess')} description={t('dashboard.state.noAccessHint')} /> : null}

      {layout.status === 'ready' && layout.items.length === 0 ? (
        <EmptyState
          title={t('dashboard.empty.board')}
          description={t('dashboard.empty.boardHint')}
          action={
            <Button size="sm" icon={<Plus className="ui-icon" aria-hidden="true" />} onClick={() => setAdding(true)}>
              {t('dashboard.actions.addCard')}
            </Button>
          }
        />
      ) : null}

      {layout.status === 'ready' && layout.items.length > 0 ? (
        <DashboardGrid
          items={layout.items}
          columns={columns}
          editing={editing}
          getData={data.get}
          onRetry={data.retry}
          onChange={layout.update}
          onRemoveRequest={setRemoving}
          onClose={removeCard}
          announce={announce}
        />
      ) : null}

      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="dashboard-announcer">
        {announcement}
      </div>

      <AddCardDialog open={adding} items={layout.items} permissions={permissions} isOwner={isOwner} onClose={() => setAdding(false)} onAdd={addCard} />

      <Modal
        open={removing !== null}
        title={t('dashboard.remove.title')}
        closeLabel={t('dashboard.add.close')}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="outline" tone="surface" onClick={() => setRemoving(null)}>
              {t('dashboard.remove.cancel')}
            </Button>
            <Button variant="outline" tone="error" onClick={confirmRemove}>
              {t('dashboard.remove.confirm')}
            </Button>
          </>
        }
      >
        <p>{removing ? t('dashboard.remove.body', { title: t(getDashboardWidget(removing.widget).titleKey) }) : null}</p>
      </Modal>

      <Modal
        open={confirmReset}
        title={t('dashboard.reset.title')}
        closeLabel={t('dashboard.add.close')}
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button variant="outline" tone="surface" onClick={() => setConfirmReset(false)}>
              {t('dashboard.remove.cancel')}
            </Button>
            <Button variant="outline" tone="error" onClick={() => void doReset()}>
              {t('dashboard.reset.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('dashboard.reset.body')}</p>
      </Modal>

      {toast || undo ? (
        <Float>
          {undo ? (
            <Toast closeLabel={t('dashboard.add.close')} onClose={() => setUndo(null)}>
              <span className="inline-flex items-center gap-3">
                {t('dashboard.toast.removed')}
                <Button size="sm" variant="outline" tone="surface" onClick={undoRemove}>
                  {t('dashboard.toast.undo')}
                </Button>
              </span>
            </Toast>
          ) : null}
          {toast ? (
            <Toast tone="error" closeLabel={t('dashboard.add.close')} onClose={() => setToast(null)}>
              {toast}
            </Toast>
          ) : null}
        </Float>
      ) : null}
    </div>
  );
}
