'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LoyaltyMemberSummaryDTO, LoyaltyRedeemResultDTO } from '@platform/shared';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { useLocale, useT } from '@/components/i18n/I18nProvider';
import { bffFetch, BffError } from '@/lib/session/client';
import { hasAnyPermission } from '@/lib/nav';
import { loyaltyErrorMessage, newIdempotencyKey, rewardSummary } from './labels';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { Input } from '@/components/ui/Input';
import { List, ListItem } from '@/components/ui/List';
import { Select } from '@/components/ui/Select';

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
    <Card as="section" aria-labelledby="loyalty-panel-title" data-testid="loyalty-panel">
      <CardContent>
        <h3 id="loyalty-panel-title" className="ui-heading">
          {t('loyalty.card.title')}
        </h3>
        {!summary.enabled && <p className="ui-caption">{t('loyalty.card.disabled')}</p>}
        <div className="grid gap-1">
          <p className="ui-stat-value" data-testid="loyalty-balance">
            {t('loyalty.points', { count: summary.balance })}
          </p>
          <p className="ui-caption">{t('loyalty.card.balance')}</p>
          {summary.nextExpiry && (
            <p className="ui-caption">{t('loyalty.card.nextExpiry', { points: summary.nextExpiry.points, date: date(summary.nextExpiry.expiresAt) })}</p>
          )}
        </div>
        <dl className="grid gap-1">
          <div className="flex justify-between">
            <dt className="ui-caption">{t('loyalty.card.lifetimeEarned')}</dt>
            <dd>{summary.lifetimeEarned}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="ui-caption">{t('loyalty.card.lifetimeRedeemed')}</dt>
            <dd>{summary.lifetimeRedeemed}</dd>
          </div>
        </dl>

        {message && (
          <p role="status" className={message.tone === 'error' ? 'ui-caption ui-text-error' : 'ui-caption ui-text-success'}>
            {message.text}
          </p>
        )}

        {canRedeem && summary.enabled && (
          <div className="ui-rule grid gap-2 pt-3">
            <h4 className="ui-caption ui-strong">{t('loyalty.card.redeemTitle')}</h4>
            {affordable.length === 0 ? (
              <p className="ui-caption">{t('loyalty.card.noRewards')}</p>
            ) : (
              <>
                <FieldGroup label={t('loyalty.card.redeemReward')}>
                  <Select id="loyalty-redeem-reward" value={rewardId} onChange={(e) => setRewardId(e.target.value)}>
                    <option value="" />
                    {affordable.map((r) => (
                      <option key={r.id} value={r.id}>
                        {`${r.name} (${t('loyalty.points', { count: r.costPoints })}) - ${rewardSummary(t, r, locale)}`}
                      </option>
                    ))}
                  </Select>
                </FieldGroup>
                <Button variant="outline" tone="surface" size="sm" disabled={busy || !rewardId} onClick={redeem} className="justify-self-start">
                  {t('loyalty.card.redeemSubmit')}
                </Button>
              </>
            )}
          </div>
        )}

        {canManage && summary.enabled && (
          <div className="ui-rule grid gap-2 pt-3">
            <h4 className="ui-caption ui-strong">{t('loyalty.card.adjustTitle')}</h4>
            {summary.presets.length > 0 && (
              <FieldGroup label={t('loyalty.card.adjustPreset')}>
                <Select id="loyalty-adjust-preset" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
                  <option value="">{t('loyalty.card.adjustPresetNone')}</option>
                  {summary.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.name} (${t('loyalty.points', { count: p.points })})`}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
            )}
            <FieldGroup label={t('loyalty.card.adjustPoints')}>
              <Input id="loyalty-adjust-points" type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
            </FieldGroup>
            <FieldGroup label={t('loyalty.card.adjustNote')}>
              <Input id="loyalty-adjust-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </FieldGroup>
            <Button
              variant="outline"
              tone="surface"
              size="sm"
              disabled={busy || !Number(points) || !note.trim()}
              onClick={adjust}
              className="justify-self-start"
            >
              {t('loyalty.card.adjustSubmit')}
            </Button>
          </div>
        )}

        <div className="ui-rule grid gap-1 pt-3">
          <h4 className="ui-caption ui-strong">{t('loyalty.card.history')}</h4>
          {summary.ledger.length === 0 ? (
            <p className="ui-caption">{t('loyalty.card.noHistory')}</p>
          ) : (
            <List data-testid="loyalty-history">
              {summary.ledger.map((row) => (
                <ListItem key={row.id} className="flex justify-between gap-2">
                  <span>
                    {t(`loyalty.reason.${row.reason}`)}
                    {row.note ? ` - ${row.note}` : ''}
                    <span className="ui-caption block">
                      {date(row.createdAt)}
                      {row.createdByName ? `, ${t('loyalty.card.by', { name: row.createdByName })}` : ''}
                      {row.expiresAt ? `, ${t('loyalty.card.expires', { date: date(row.expiresAt) })}` : ''}
                    </span>
                  </span>
                  <span className={row.delta < 0 ? 'ui-strong ui-text-error shrink-0' : 'ui-strong shrink-0'}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </span>
                </ListItem>
              ))}
            </List>
          )}
        </div>

        {summary.redemptions.length > 0 && (
          <div className="ui-rule grid gap-1 pt-3">
            <h4 className="ui-caption ui-strong">{t('loyalty.card.redemptions')}</h4>
            <List>
              {summary.redemptions.map((r) => (
                <ListItem key={r.id} className="flex justify-between gap-2">
                  <span>
                    {r.rewardName}
                    {r.promoCode ? ` - ${r.promoCode}` : ''}
                  </span>
                  <span className="ui-caption">{date(r.createdAt)}</span>
                </ListItem>
              ))}
            </List>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
