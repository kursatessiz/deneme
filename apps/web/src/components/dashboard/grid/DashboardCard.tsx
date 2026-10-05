'use client';

import { forwardRef, useId } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Check, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react';
import type { DashboardPeriod } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem, DropdownSection } from '@/components/ui/Dropdown';
import { cx } from '@/components/ui/types';
import type { WidgetView } from './widgets';

export interface DashboardCardProps {
  id: string;
  title: string;
  description: string;
  period: DashboardPeriod | null;
  periods: readonly DashboardPeriod[];
  view: WidgetView;
  editing: boolean;
  /** Drag and resize by pointer (wide grid only); otherwise reorder from the menu or the keyboard. */
  pointerEditing: boolean;
  dragging: boolean;
  atLimit: boolean;
  sizeLabel: string | null;
  style: CSSProperties;
  /** Stored position and size (12 column grid), exposed as data attributes for tests and debugging. */
  geometry: { x: number; y: number; w: number; h: number };
  canMoveUp: boolean;
  canMoveDown: boolean;
  keyboardHelpId: string;
  onHandlePointerDown: (e: PointerEvent<HTMLElement>) => void;
  onResizePointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPeriodChange: (period: DashboardPeriod) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  children: ReactNode;
}

/**
 * The shell every overview card shares: a header with the title, its
 * period, a link to the screen behind it and the card menu; in edit mode a
 * drag grip, a resize corner and keyboard focus. The body is a size
 * container (ui-dash-card), so the content adapts to the card.
 */
export const DashboardCard = forwardRef<HTMLElement, DashboardCardProps>(function DashboardCard(props, ref) {
  const t = useT();
  const titleId = useId();
  const {
    id,
    title,
    description,
    period,
    periods,
    view,
    editing,
    pointerEditing,
    dragging,
    atLimit,
    sizeLabel,
    style,
    geometry,
    canMoveUp,
    canMoveDown,
    keyboardHelpId,
    onHandlePointerDown,
    onResizePointerDown,
    onKeyDown,
    onPeriodChange,
    onMove,
    onRemove,
    children,
  } = props;
  const showMenu = editing || periods.length > 1;

  return (
    <section
      ref={ref}
      id={`dash-card-${id}`}
      data-testid="dashboard-card"
      data-card-id={id}
      data-x={geometry.x}
      data-y={geometry.y}
      data-w={geometry.w}
      data-h={geometry.h}
      aria-labelledby={titleId}
      aria-describedby={editing ? keyboardHelpId : undefined}
      tabIndex={editing ? 0 : undefined}
      onKeyDown={editing ? onKeyDown : undefined}
      className="pui-card ui-dash-card"
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-limit={atLimit ? 'true' : 'false'}
      data-inline={view.inline ? 'true' : 'false'}
      style={style}
    >
      <div className="ui-dash-head">
        {editing && pointerEditing ? (
          <Button
            variant="link"
            tone="muted"
            size="sm"
            iconOnly
            tabIndex={-1}
            className="ui-dash-handle"
            aria-label={t('dashboard.card.drag', { title })}
            icon={<GripVertical className="ui-icon" aria-hidden="true" />}
            onPointerDown={onHandlePointerDown}
          />
        ) : null}
        <div className="grid flex-1 min-w-0">
          <h3 id={titleId} className="ui-heading truncate" title={description}>
            {title}
          </h3>
          {period ? <span className="ui-caption truncate">{t(`dashboard.period.${period}`)}</span> : null}
        </div>
        {view.link && !editing ? (
          <Link href={view.link.href} className="pui-link pui-theme ui-small whitespace-nowrap">
            {t(view.link.labelKey)}
          </Link>
        ) : null}
        {showMenu ? (
          <Dropdown
            label={<MoreHorizontal className="ui-icon" aria-hidden="true" />}
            ariaLabel={t('dashboard.card.menu', { title })}
            variant="link"
            tone="muted"
            size="sm"
            iconOnly
            align="end"
          >
            {periods.length > 1 ? (
              <>
                <DropdownSection className="ui-caption">{t('dashboard.card.period')}</DropdownSection>
                {periods.map((p) => (
                  <DropdownItem key={p} aria-current={p === period ? 'true' : undefined} onClick={() => onPeriodChange(p)}>
                    <span className="inline-flex items-center gap-2">
                      <Check className={cx('ui-icon', p !== period && 'invisible')} aria-hidden="true" />
                      {t(`dashboard.period.${p}`)}
                    </span>
                  </DropdownItem>
                ))}
              </>
            ) : null}
            {editing ? (
              <>
                <DropdownItem disabled={!canMoveUp} onClick={() => onMove(-1)}>
                  <span className="inline-flex items-center gap-2">
                    <ArrowUp className="ui-icon" aria-hidden="true" />
                    {t('dashboard.card.moveUp')}
                  </span>
                </DropdownItem>
                <DropdownItem disabled={!canMoveDown} onClick={() => onMove(1)}>
                  <span className="inline-flex items-center gap-2">
                    <ArrowDown className="ui-icon" aria-hidden="true" />
                    {t('dashboard.card.moveDown')}
                  </span>
                </DropdownItem>
                <DropdownItem className="ui-text-error" onClick={onRemove}>
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="ui-icon" aria-hidden="true" />
                    {t('dashboard.card.remove')}
                  </span>
                </DropdownItem>
              </>
            ) : null}
          </Dropdown>
        ) : null}
      </div>
      <div className="ui-dash-body" data-flush={view.flush ? 'true' : 'false'}>
        {children}
      </div>
      {editing && pointerEditing ? (
        <>
          {sizeLabel ? <span className="ui-dash-size ui-caption">{sizeLabel}</span> : null}
          <button type="button" tabIndex={-1} className="ui-dash-resize" aria-label={t('dashboard.card.resize', { title })} onPointerDown={onResizePointerDown} />
        </>
      ) : null}
    </section>
  );
});
