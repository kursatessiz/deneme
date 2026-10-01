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
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { Card } from '@/components/ui/Card';

type PromoCodeRow = PromoCodeDTO;
type GiftCardRow = GiftCardDTO;

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
        <Input placeholder={t('finance.promotions.codePlaceholder')} value={code} onChange={(e) => setCode(e.target.value)} className="w-full" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as PromoCodeKind)} className="w-full">
          {Object.values(PromoCodeKind).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          placeholder={t('finance.promotions.valuePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full"
        />
        {error && <p className="ui-caption ui-text-error">{error}</p>}
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
        <h3 className="ui-heading">{t('finance.promotions.codesTitle')}</h3>
        <PermissionButton required={['promotions.manage']} variant="primary" onClick={() => setShowNew(true)}>
          {t('finance.promotions.newCode')}
        </PermissionButton>
      </div>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!codes || codes.length === 0) && <EmptyState title={t('finance.promotions.empty')} />}
      {!loading && !error && codes && codes.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('finance.promotions.col.code'),
                  t('finance.promotions.col.kind'),
                  t('finance.promotions.col.value'),
                  t('finance.promotions.col.usage'),
                  t('finance.promotions.col.status'),
                  '',
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {codes.map((c) => (
                <Tr key={c.id}>
                  <Td className="ui-strong">{c.code}</Td>
                  <Td>{kindLabel(c.kind)}</Td>
                  <Td>
                    {c.kind === 'PERCENT'
                      ? `%${c.value}`
                      : c.kind === 'FIXED_AMOUNT'
                        ? formatMoney(c.value)
                        : t('finance.promotions.valueUnit', { value: c.value })}
                  </Td>
                  <Td>
                    {c.redeemedCount}
                    {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                  </Td>
                  <Td>
                    <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? t('finance.promotions.active') : t('finance.promotions.inactive')}</Badge>
                  </Td>
                  <Td className="text-right">
                    <PermissionButton required={['promotions.manage']} onClick={() => toggleActive(c)}>
                      {c.isActive ? t('finance.promotions.deactivate') : t('finance.promotions.activate')}
                    </PermissionButton>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
      <h3 className="ui-heading">{t('finance.promotions.giftCardsTitle')}</h3>
      <p className="ui-caption">{t('finance.promotions.giftCardsHint')}</p>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!cards || cards.length === 0) && <EmptyState title={t('finance.promotions.giftCardsEmpty')} />}
      {!loading && !error && cards && cards.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                {[
                  t('finance.promotions.col.card'),
                  t('finance.promotions.col.recipient'),
                  t('finance.promotions.col.initial'),
                  t('finance.promotions.col.balance'),
                  t('finance.promotions.col.status'),
                ].map((h, i) => (
                  <Th key={i} className="whitespace-nowrap">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {cards.map((g) => (
                <Tr key={g.id}>
                  <Td className="font-mono ui-caption">**** {g.last4}</Td>
                  <Td>{g.recipientName ?? '-'}</Td>
                  <Td>{formatMoney(g.initialAmount)}</Td>
                  <Td className="ui-strong">{formatMoney(g.balance)}</Td>
                  <Td>
                    <Badge tone={g.status === 'ACTIVE' ? 'success' : 'neutral'}>{g.status}</Badge>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
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
