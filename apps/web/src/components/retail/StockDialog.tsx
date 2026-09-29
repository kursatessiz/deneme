'use client';

import { useState } from 'react';
import type { BranchDTO, ProductDTO } from '@platform/shared';
import { useT } from '@/components/i18n/I18nProvider';
import { bffFetch } from '@/lib/session/client';
import { useBff } from '@/lib/session/use-bff';
import { retailErrorMessage } from '@/lib/retail/errors';
import { Modal } from '@/components/common/Modal';
import { PermissionButton } from '@/components/common/PermissionButton';
import { fieldClass, fieldStyle, labelStyle } from './styles';

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
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold mb-1" style={labelStyle}>
            {t('retail.stock.levels')}
          </h4>
          {product.stock.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('retail.stock.none')}
            </p>
          ) : (
            <ul className="text-sm space-y-0.5" style={{ color: 'var(--color-text-primary)' }}>
              {product.stock.map((s) => (
                <li key={s.branchId} className="flex justify-between">
                  <span>{s.branchName}</span>
                  <span className="font-medium">{s.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div role="radiogroup" aria-label={t('retail.stock.levels')} className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className="text-xs px-3 py-1.5"
              style={{
                ...fieldStyle,
                borderColor: mode === m ? 'var(--color-primary)' : 'var(--color-border)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {t(`retail.stock.mode.${m}`)}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs space-y-1" style={labelStyle}>
              <span>{mode === 'transfer' ? t('retail.stock.fromBranch') : t('retail.branch')}</span>
              <select value={from} onChange={(e) => setBranchId(e.target.value)} className={fieldClass} style={fieldStyle}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {mode === 'transfer' && (
              <label className="block text-xs space-y-1" style={labelStyle}>
                <span>{t('retail.stock.toBranch')}</span>
                <select value={to} onChange={(e) => setToBranchId(e.target.value)} className={fieldClass} style={fieldStyle}>
                  {branches
                    .filter((b) => b.id !== from)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="block text-xs space-y-1" style={labelStyle}>
              <span>{mode === 'adjust' ? t('retail.stock.delta') : mode === 'count' ? t('retail.stock.counted') : t('retail.stock.quantity')}</span>
              <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={fieldClass} style={fieldStyle} />
            </label>
            {mode === 'receive' && (
              <label className="block text-xs space-y-1" style={labelStyle}>
                <span>{t('retail.stock.unitCost')}</span>
                <input inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={fieldClass} style={fieldStyle} />
              </label>
            )}
          </div>
          <label className="block text-xs space-y-1" style={labelStyle}>
            <span>{t('retail.stock.reason')}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} style={fieldStyle} />
          </label>
          {mode === 'receive' && (
            <label className="block text-xs space-y-1" style={labelStyle}>
              <span>{t('retail.stock.reference')}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={fieldClass} style={fieldStyle} />
            </label>
          )}
          {error && (
            <p className="text-xs" style={{ color: 'var(--color-danger, #b42318)' }}>
              {error}
            </p>
          )}
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
