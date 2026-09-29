'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LoyaltyMemberSummaryDTO, LoyaltyRedeemResultDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { loyaltyErrorMessage, newIdempotencyKey, rewardSummary } from './labels';

const fieldClass = 'w-full px-3 py-2 text-sm border';
const fieldStyle = {
  borderColor: 'var(--color-border)',
  borderRadius: 'var(--radius-input)',
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
} as const;
const labelStyle = { color: 'var(--color-text-secondary)' } as const;
const buttonStyle = { borderColor: 'var(--color-border)', borderRadius: 'var(--radius-button)', color: 'var(--color-text-primary)' } as const;

/**
 * Member card loyalty panel (G3a): balance, next expiry, recent history,
 * manual adjustment (loyalty.manage) and redemption (loyalty.redeem).
 * Hidden entirely without loyalty.view.
 */
export function LoyaltyPanel({ memberId }: { memberId: string }) {
  const t = useT();
  const locale = useLocale();
  const { activeStudioId, permissions, isOwner } = useDashboardSession();
  const canView = hasAnyPermission(['loyalty.view'], permissions, isOwner);
  const canManage = hasAnyPermission(['loyalty.manage'], permissions, isOwner);
  const canRedeem = hasAnyPermission(['loyalty.redeem'], permissions, isOwner);
  const [summary, setSummary] = useState<LoyaltyMemberSummaryDTO | null>(null);
  const [hidden, setHidden] = useState(false);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [presetId, setPresetId] = useState('');
  const [rewardId, setRewardId] = useState('');
  const [adjustKey, setAdjustKey] = useState(newIdempotencyKey);
  const [redeemKey, setRedeemKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const path = `studios/${activeStudioId}/loyalty/members/${memberId}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const load = useCallback(() => {
    if (!activeStudioId || !canView) return;
    bffFetch<LoyaltyMemberSummaryDTO>(path, { studioId: activeStudioId })
      .then((s) => {
        setSummary(s);
        setHidden(false);
      })
      .catch((err) => {
        // No permission or no member profile: the panel stays out of the card.
        if (err instanceof BffError && (err.status === 403 || err.status === 404)) setHidden(true);
      });
  }, [activeStudioId, canView, path]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView || hidden || !summary) return null;

  const choosePreset = (id: string) => {
    setPresetId(id);
    const preset = summary.presets.find((p) => p.id === id);
    if (preset) {
      setPoints(String(preset.points));
      if (!note.trim()) setNote(preset.name);
    }
  };

  const adjust = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await bffFetch<LoyaltyMemberSummaryDTO>(`${path}/adjust`, {
        method: 'POST',
        studioId: activeStudioId,
        body: { points: Number(points), note: note.trim(), idempotencyKey: adjustKey, ...(presetId ? { ruleId: presetId } : {}) },
      });
      setSummary(next);
      setPoints('');
      setNote('');
      setPresetId('');
      setAdjustKey(newIdempotencyKey());
      setMessage({ text: t('loyalty.card.adjusted'), tone: 'success' });
    } catch (err) {
      setMessage({ text: loyaltyErrorMessage(err, t), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await bffFetch<LoyaltyRedeemResultDTO>(`${path}/redeem`, {
        method: 'POST',
        studioId: activeStudioId,
        body: { rewardId, idempotencyKey: redeemKey },
      });
      const parts = [t('loyalty.card.redeemed', { reward: result.redemption.rewardName })];
      if (result.redemption.promoCode) {
        parts.push(
          t('loyalty.card.promoCode', {
            code: result.redemption.promoCode,
            date: result.redemption.promoCodeValidTo ? date(result.redemption.promoCodeValidTo) : '',
          }),
        );
      }
      setMessage({ text: parts.join(' '), tone: 'success' });
      setRewardId('');
      setRedeemKey(newIdempotencyKey());
      load();
    } catch (err) {
      setMessage({ text: loyaltyErrorMessage(err, t), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const affordable = summary.rewards.filter((r) => r.affordable);

  return (
    <section
      className="p-4 space-y-3"
      aria-labelledby="loyalty-panel-title"
      data-testid="loyalty-panel"
      style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h3 id="loyalty-panel-title" className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        {t('loyalty.card.title')}
      </h3>
      {!summary.enabled && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('loyalty.card.disabled')}
        </p>
      )}
      <div>
        <p className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }} data-testid="loyalty-balance">
          {t('loyalty.points', { count: summary.balance })}
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('loyalty.card.balance')}
        </p>
        {summary.nextExpiry && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {t('loyalty.card.nextExpiry', { points: summary.nextExpiry.points, date: date(summary.nextExpiry.expiresAt) })}
          </p>
        )}
      </div>
      <dl className="text-xs space-y-1">
        <div className="flex justify-between">
          <dt style={{ color: 'var(--color-text-muted)' }}>{t('loyalty.card.lifetimeEarned')}</dt>
          <dd style={{ color: 'var(--color-text-primary)' }}>{summary.lifetimeEarned}</dd>
        </div>
        <div className="flex justify-between">
          <dt style={{ color: 'var(--color-text-muted)' }}>{t('loyalty.card.lifetimeRedeemed')}</dt>
          <dd style={{ color: 'var(--color-text-primary)' }}>{summary.lifetimeRedeemed}</dd>
        </div>
      </dl>

      {message && (
        <p role="status" className="text-xs" style={{ color: message.tone === 'error' ? 'var(--color-danger, #b42318)' : 'var(--color-success, #2f7d4f)' }}>
          {message.text}
        </p>
      )}

      {canRedeem && summary.enabled && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-xs font-semibold" style={labelStyle}>
            {t('loyalty.card.redeemTitle')}
          </h4>
          {affordable.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('loyalty.card.noRewards')}
            </p>
          ) : (
            <>
              <label htmlFor="loyalty-redeem-reward" className="block text-xs" style={labelStyle}>
                {t('loyalty.card.redeemReward')}
              </label>
              <select id="loyalty-redeem-reward" value={rewardId} onChange={(e) => setRewardId(e.target.value)} className={fieldClass} style={fieldStyle}>
                <option value="" />
                {affordable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${r.name} (${t('loyalty.points', { count: r.costPoints })}) - ${rewardSummary(t, r, locale)}`}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || !rewardId} onClick={redeem} className="text-xs font-medium px-3 py-2 border disabled:opacity-50" style={buttonStyle}>
                {t('loyalty.card.redeemSubmit')}
              </button>
            </>
          )}
        </div>
      )}

      {canManage && summary.enabled && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-xs font-semibold" style={labelStyle}>
            {t('loyalty.card.adjustTitle')}
          </h4>
          {summary.presets.length > 0 && (
            <>
              <label htmlFor="loyalty-adjust-preset" className="block text-xs" style={labelStyle}>
                {t('loyalty.card.adjustPreset')}
              </label>
              <select id="loyalty-adjust-preset" value={presetId} onChange={(e) => choosePreset(e.target.value)} className={fieldClass} style={fieldStyle}>
                <option value="">{t('loyalty.card.adjustPresetNone')}</option>
                {summary.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.name} (${t('loyalty.points', { count: p.points })})`}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="loyalty-adjust-points" className="block text-xs" style={labelStyle}>
            {t('loyalty.card.adjustPoints')}
          </label>
          <input id="loyalty-adjust-points" type="number" value={points} onChange={(e) => setPoints(e.target.value)} className={fieldClass} style={fieldStyle} />
          <label htmlFor="loyalty-adjust-note" className="block text-xs" style={labelStyle}>
            {t('loyalty.card.adjustNote')}
          </label>
          <input id="loyalty-adjust-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={fieldClass} style={fieldStyle} />
          <button
            type="button"
            disabled={busy || !Number(points) || !note.trim()}
            onClick={adjust}
            className="text-xs font-medium px-3 py-2 border disabled:opacity-50"
            style={buttonStyle}
          >
            {t('loyalty.card.adjustSubmit')}
          </button>
        </div>
      )}

      <div className="space-y-1 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <h4 className="text-xs font-semibold" style={labelStyle}>
          {t('loyalty.card.history')}
        </h4>
        {summary.ledger.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('loyalty.card.noHistory')}
          </p>
        ) : (
          <ul className="text-xs space-y-1" data-testid="loyalty-history">
            {summary.ledger.map((row) => (
              <li key={row.id} className="flex justify-between gap-2">
                <span style={{ color: 'var(--color-text-primary)' }}>
                  {t(`loyalty.reason.${row.reason}`)}
                  {row.note ? ` - ${row.note}` : ''}
                  <span className="block" style={{ color: 'var(--color-text-muted)' }}>
                    {date(row.createdAt)}
                    {row.createdByName ? `, ${t('loyalty.card.by', { name: row.createdByName })}` : ''}
                    {row.expiresAt ? `, ${t('loyalty.card.expires', { date: date(row.expiresAt) })}` : ''}
                  </span>
                </span>
                <span className="font-semibold shrink-0" style={{ color: row.delta < 0 ? 'var(--color-danger, #b42318)' : 'var(--color-text-primary)' }}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary.redemptions.length > 0 && (
        <div className="space-y-1 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-xs font-semibold" style={labelStyle}>
            {t('loyalty.card.redemptions')}
          </h4>
          <ul className="text-xs space-y-1">
            {summary.redemptions.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span style={{ color: 'var(--color-text-primary)' }}>
                  {r.rewardName}
                  {r.promoCode ? ` - ${r.promoCode}` : ''}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>{date(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
