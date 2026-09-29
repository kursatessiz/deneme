'use client';

import { useState } from 'react';
import { PromoCodeKind } from '@platform/shared';
import type { PromoCodeDTO, GiftCardDTO } from '@platform/shared';
import { useDashboardSession, useFormatMoney } from '@/components/session/DashboardSessionProvider';
import { useT } from '@/components/i18n/I18nProvider';
import { useBff } from '@/lib/session/use-bff';
import { bffFetch, BffError } from '@/lib/session/client';
import { formatMoney } from '@/lib/money';
import { LoadingState, EmptyState, ErrorState } from '@/components/common/DataState';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';

type PromoCodeRow = PromoCodeDTO;
type GiftCardRow = GiftCardDTO;

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-input)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
};

function NewPromoCodeDialog({ studioId, onClose, onDone }: { studioId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<PromoCodeKind>(PromoCodeKind.PERCENT);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindLabel = (k: string) => t(`finance.promoKind.${k}`);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numeric = Number(value);
    if (code.trim().length < 3 || !Number.isFinite(numeric) || numeric <= 0) {
      setError(t('finance.promotions.validation'));
      return;
    }
    setSubmitting(true);
    try {
      await bffFetch('promotions/promo-codes', { method: 'POST', studioId, body: { code: code.trim().toUpperCase(), kind, value: numeric } });
      onDone();
    } catch (err) {
      setError(err instanceof BffError ? err.message : t('finance.promotions.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={t('finance.promotions.newCodeTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder={t('finance.promotions.codePlaceholder')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={inputStyle}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as PromoCodeKind)} className="w-full text-sm px-3 py-1.5" style={inputStyle}>
          {Object.values(PromoCodeKind).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder={t('finance.promotions.valuePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full text-sm px-3 py-1.5"
          style={inputStyle}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <PermissionButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PermissionButton>
          <PermissionButton required={['promotions.manage']} type="submit" variant="primary" disabled={submitting}>
            {submitting ? t('finance.promotions.creating') : t('common.create')}
          </PermissionButton>
        </div>
      </form>
    </Modal>
  );
}

function PromoCodesSection() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const [showNew, setShowNew] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { data: codes, loading, error } = useBff<PromoCodeRow[]>(activeStudioId ? `promotions/promo-codes?_=${reloadKey}` : null, activeStudioId);
  const kindLabel = (k: string) => t(`finance.promoKind.${k}`);

  async function toggleActive(row: PromoCodeRow) {
    if (!activeStudioId) return;
    try {
      await bffFetch(`promotions/promo-codes/${row.id}`, { method: 'PUT', studioId: activeStudioId, body: { isActive: !row.isActive } });
      setReloadKey((k) => k + 1);
    } catch (err) {
      window.alert(err instanceof BffError ? err.message : t('finance.promotions.errors.updateFailed'));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {t('finance.promotions.codesTitle')}
        </h3>
        <PermissionButton required={['promotions.manage']} variant="primary" onClick={() => setShowNew(true)}>
          {t('finance.promotions.newCode')}
        </PermissionButton>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!codes || codes.length === 0) && <EmptyState title={t('finance.promotions.empty')} />}
      {!loading && !error && codes && codes.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[
                  t('finance.promotions.col.code'),
                  t('finance.promotions.col.kind'),
                  t('finance.promotions.col.value'),
                  t('finance.promotions.col.usage'),
                  t('finance.promotions.col.status'),
                  '',
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {c.code}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {kindLabel(c.kind)}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-primary)' }}>
                    {c.kind === 'PERCENT' ? `%${c.value}` : c.kind === 'FIXED_AMOUNT' ? formatMoney(c.value) : t('finance.promotions.valueUnit', { value: c.value })}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {c.redeemedCount}
                    {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? t('finance.promotions.active') : t('finance.promotions.inactive')}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <PermissionButton required={['promotions.manage']} onClick={() => toggleActive(c)}>
                      {c.isActive ? t('finance.promotions.deactivate') : t('finance.promotions.activate')}
                    </PermissionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showNew && activeStudioId && (
        <NewPromoCodeDialog
          studioId={activeStudioId}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function GiftCardsSection() {
  const t = useT();
  const formatMoney = useFormatMoney();
  const { activeStudioId } = useDashboardSession();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: cards, loading, error } = useBff<GiftCardRow[]>(activeStudioId ? `promotions/gift-cards?_=${reloadKey}` : null, activeStudioId);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {t('finance.promotions.giftCardsTitle')}
      </h3>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {t('finance.promotions.giftCardsHint')}
      </p>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!cards || cards.length === 0) && <EmptyState title={t('finance.promotions.giftCardsEmpty')} />}
      {!loading && !error && cards && cards.length > 0 && (
        <div className="border overflow-x-auto" style={{ borderColor: 'var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface-muted)' }}>
                {[
                  t('finance.promotions.col.card'),
                  t('finance.promotions.col.recipient'),
                  t('finance.promotions.col.initial'),
                  t('finance.promotions.col.balance'),
                  t('finance.promotions.col.status'),
                ].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map((g) => (
                <tr key={g.id} className="border-t" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--color-text-primary)' }}>
                    **** {g.last4}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {g.recipientName ?? '-'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatMoney(g.initialAmount)}
                  </td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {formatMoney(g.balance)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={g.status === 'ACTIVE' ? 'success' : 'neutral'}>{g.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PromotionsTab() {
  return (
    <div className="space-y-8">
      <PromoCodesSection />
      <GiftCardsSection />
    </div>
  );
}
