'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { DASHBOARD_GRID, DASHBOARD_WIDGET_CATEGORIES, DASHBOARD_WIDGETS, canViewDashboardWidget } from '@platform/shared';
import type { DashboardLayoutItem, DashboardWidgetDefinition, DashboardWidgetKey, PermissionKey } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InputGroup, Addon } from '@/components/ui/InputGroup';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';

export interface AddCardDialogProps {
  open: boolean;
  items: readonly DashboardLayoutItem[];
  permissions: readonly PermissionKey[];
  isOwner: boolean;
  onClose: () => void;
  onAdd: (widget: DashboardWidgetKey) => void;
}

/** Lowercased, accent-folded text for the search box (works for Turkish and English titles). */
function fold(text: string, locale: string): string {
  return text
    .toLocaleLowerCase(locale)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}

/**
 * "Kart ekle": the card catalogue grouped by category, with search. Cards
 * the membership may not see are not listed at all; a single-instance card
 * already on the board is shown disabled with a hint, and a full board
 * disables every card.
 */
export function AddCardDialog({ open, items, permissions, isOwner, onClose, onAdd }: AddCardDialogProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const full = items.length >= DASHBOARD_GRID.maxItems;
  const onBoard = useMemo(() => new Set(items.map((i) => i.widget)), [items]);

  const visible = useMemo(() => {
    const q = fold(query.trim(), 'tr');
    return DASHBOARD_WIDGETS.filter((w) => canViewDashboardWidget(w, permissions, isOwner)).filter((w) => {
      if (!q) return true;
      return fold(`${t(w.titleKey)} ${t(w.descriptionKey)} ${t(`dashboard.category.${w.category}`)}`, 'tr').includes(q);
    });
  }, [isOwner, permissions, query, t]);

  const close = () => {
    setQuery('');
    onClose();
  };

  const row = (w: DashboardWidgetDefinition) => {
    const taken = w.singleton && onBoard.has(w.key);
    const disabled = taken || full;
    const title = t(w.titleKey);
    return (
      <li key={w.key} className="pui-list-item flex items-center gap-3 min-w-0" data-testid="add-card-option" data-widget={w.key}>
        <span className="grid flex-1 min-w-0">
          <span className="ui-heading">{title}</span>
          <span className="ui-caption">{t(w.descriptionKey)}</span>
          <span className="ui-caption">
            {t('dashboard.add.size', { width: w.size.defaultW, height: w.size.defaultH })}
            {taken ? ` · ${t('dashboard.add.alreadyOnBoard')}` : ''}
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          tone="theme"
          disabled={disabled}
          aria-label={t('dashboard.add.addNamed', { title })}
          icon={<Plus className="ui-icon" aria-hidden="true" />}
          onClick={() => {
            setQuery('');
            onAdd(w.key);
          }}
        >
          {t('dashboard.add.add')}
        </Button>
      </li>
    );
  };

  return (
    <Modal open={open} wide title={t('dashboard.add.title')} closeLabel={t('dashboard.add.close')} onClose={close}>
      <div className="grid gap-4">
        <InputGroup>
          <Addon>
            <Search className="ui-icon" aria-hidden="true" />
          </Addon>
          <Input type="search" value={query} aria-label={t('dashboard.add.search')} placeholder={t('dashboard.add.search')} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        {full ? <p className="ui-text-warn ui-small">{t('dashboard.add.full', { max: DASHBOARD_GRID.maxItems })}</p> : null}
        {visible.length === 0 ? <EmptyState title={t('dashboard.add.noMatch')} className="py-6" /> : null}
        <div className="grid gap-4" style={{ maxHeight: 'min(60vh, 32rem)', overflowY: 'auto' }}>
          {DASHBOARD_WIDGET_CATEGORIES.map((category) => {
            const group = visible.filter((w) => w.category === category);
            if (group.length === 0) return null;
            return (
              <section key={category} aria-labelledby={`add-card-${category}`} className="grid gap-1">
                <h4 id={`add-card-${category}`} className="ui-eyebrow ui-caption">
                  {t(`dashboard.category.${category}`)}
                </h4>
                <ul className="pui-list ui-divide">{group.map(row)}</ul>
              </section>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
