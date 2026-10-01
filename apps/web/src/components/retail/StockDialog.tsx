'use client';

import { useState } from 'react';
import type { BranchDTO, ProductDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { retailErrorMessage } from '@/lib/retail/errors';
import { Modal } from '@/components/common/Modal';
import { PermissionButton } from '@/components/common/PermissionButton';
import { Button, FieldGroup, Input, List, ListItem, Select } from '@/components/ui';

const MODES = ['receive', 'adjust', 'count', 'transfer'] as const;
type Mode = (typeof MODES)[number];

/** Receive, correct, count or transfer one product's stock; every change goes through the API's stock ledger. */
export function StockDialog({ studioId, product, onClose, onDone }: { studioId: string; product: ProductDTO; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { data: branchData } = useBff<BranchDTO[]>(`branches/studio/${studioId}`, studioId);
  const branches = (branchData ?? []).filter((b) => b.isActive);
  const [mode, setMode] = useState<Mode>('receive');
  const [branchId, setBranchId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = branchId || branches[0]?.id || '';
  const to = toBranchId || branches.find((b) => b.id !== from)?.id || '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(quantity);
    const valid = mode === 'adjust' ? Number.isInteger(n) && n !== 0 : mode === 'count' ? Number.isInteger(n) && n >= 0 : Number.isInteger(n) && n > 0;
    if (!valid || !from) {
      setError(t('retail.stock.invalidQuantity'));
      return;
    }
    if ((mode === 'adjust' || mode === 'count') && reason.trim().length < 3) {
      setError(t('retail.stock.reasonRequired'));
      return;
    }
    const path = `studios/${studioId}/retail/stock/${mode === 'count' ? 'adjust' : mode}`;
    const body =
      mode === 'receive'
        ? { productId: product.id, branchId: from, quantity: n, unitCost: unitCost.trim() || undefined, reason: reason.trim() || undefined, reference: reference.trim() || undefined }
        : mode === 'adjust'
          ? { productId: product.id, branchId: from, delta: n, reason: reason.trim() }
          : mode === 'count'
            ? { productId: product.id, branchId: from, countedQuantity: n, reason: reason.trim() }
            : { productId: product.id, fromBranchId: from, toBranchId: to, quantity: n, reason: reason.trim() || undefined };
    setSaving(true);
    setError(null);
    try {
      await bffFetch(path, { method: 'POST', studioId, body });
      onDone();
    } catch (err) {
      setError(retailErrorMessage(t, err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t('retail.stock.title', { name: product.name })} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h4 className="ui-caption ui-strong">{t('retail.stock.levels')}</h4>
          {product.stock.length === 0 ? (
            <p className="ui-caption">{t('retail.stock.none')}</p>
          ) : (
            <List>
              {product.stock.map((s) => (
                <ListItem key={s.branchId} className="flex justify-between">
                  <span>{s.branchName}</span>
                  <span className="ui-strong">{s.quantity}</span>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <div role="radiogroup" aria-label={t('retail.stock.levels')} className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <Button
              key={m}
              role="radio"
              aria-checked={mode === m}
              variant={mode === m ? 'solid' : 'outline'}
              tone={mode === m ? 'theme' : 'surface'}
              size="sm"
              onClick={() => setMode(m)}
            >
              {t(`retail.stock.mode.${m}`)}
            </Button>
          ))}
        </div>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label={mode === 'transfer' ? t('retail.stock.fromBranch') : t('retail.branch')}>
              <Select value={from} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </FieldGroup>
            {mode === 'transfer' && (
              <FieldGroup label={t('retail.stock.toBranch')}>
                <Select value={to} onChange={(e) => setToBranchId(e.target.value)}>
                  {branches
                    .filter((b) => b.id !== from)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </Select>
              </FieldGroup>
            )}
            <FieldGroup label={mode === 'adjust' ? t('retail.stock.delta') : mode === 'count' ? t('retail.stock.counted') : t('retail.stock.quantity')}>
              <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </FieldGroup>
            {mode === 'receive' && (
              <FieldGroup label={t('retail.stock.unitCost')}>
                <Input inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </FieldGroup>
            )}
          </div>
          <FieldGroup label={t('retail.stock.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldGroup>
          {mode === 'receive' && (
            <FieldGroup label={t('retail.stock.reference')}>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </FieldGroup>
          )}
          {error && <p className="ui-caption ui-text-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <PermissionButton type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </PermissionButton>
            <PermissionButton required={['retail.manage']} type="submit" variant="primary" disabled={saving}>
              {t('retail.stock.submit')}
            </PermissionButton>
          </div>
        </form>
      </div>
    </Modal>
  );
}
