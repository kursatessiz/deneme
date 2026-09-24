import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { GiftCardBalanceDTO, GiftCardDTO, MemberPackageDTO, MemberSubscriptionDTO, PaymentDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { TextField } from '../../../src/components/TextField';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const GIFT_CARD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktif',
  REDEEMED: 'Bakiyesi bitti',
  EXPIRED: 'Süresi doldu',
  CANCELLED: 'İptal edildi',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Beklemede',
  COMPLETED: 'Tamamlandı',
  REFUNDED: 'İade edildi',
  FAILED: 'Başarısız',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Nakit',
  CREDIT_CARD_POS: 'Kredi kartı',
  BANK_TRANSFER: 'Havale/EFT',
  ONLINE_IYZICO: 'Online ödeme',
  ONLINE_PAYTR: 'Online ödeme',
};

function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** The member's own payment history and active subscription, with a cancel-at-period-end action. */
export default function OdemelerimScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [payments, setPayments] = useState<PaymentDTO[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<MemberSubscriptionDTO[] | null>(null);
  const [myGiftCards, setMyGiftCards] = useState<GiftCardDTO[] | null>(null);
  const [myPackages, setMyPackages] = useState<MemberPackageDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Gift card balance check
  const [checkCode, setCheckCode] = useState('');
  const [checkResult, setCheckResult] = useState<GiftCardBalanceDTO | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | undefined>();

  // Package renewal with an optional promo code / gift card
  const [selectedPackageDefinitionId, setSelectedPackageDefinitionId] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [previewText, setPreviewText] = useState<string | undefined>();
  const [previewing, setPreviewing] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [paymentList, subscriptionList, giftCardList, packageList] = await Promise.all([
        apiRequest<PaymentDTO[]>('/payments/self', { studioId }),
        apiRequest<MemberSubscriptionDTO[]>('/payments/subscriptions/self', { studioId }),
        apiRequest<GiftCardDTO[]>('/promotions/gift-cards/mine', { studioId }),
        apiRequest<MemberPackageDTO[]>('/members/self/packages', { studioId }),
      ]);
      setPayments(paymentList);
      setSubscriptions(subscriptionList);
      setMyGiftCards(giftCardList);
      setMyPackages(packageList);
      if (!selectedPackageDefinitionId && packageList.length > 0) {
        setSelectedPackageDefinitionId(packageList[0].packageDefinitionId);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ödemeler yüklenemedi.');
    }
  }, [studioId, selectedPackageDefinitionId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  const checkGiftCardBalance = async () => {
    if (!studioId || !checkCode.trim()) return;
    setChecking(true);
    setCheckError(undefined);
    setCheckResult(null);
    try {
      const result = await apiRequest<GiftCardBalanceDTO>(`/promotions/gift-cards/check?code=${encodeURIComponent(checkCode.trim())}`, {
        studioId,
      });
      setCheckResult(result);
    } catch (e) {
      setCheckError(e instanceof ApiError ? e.message : 'Hediye kartı bulunamadı.');
    } finally {
      setChecking(false);
    }
  };

  const previewPrice = async () => {
    if (!studioId || !selectedPackageDefinitionId || !promoCode.trim()) return;
    setPreviewing(true);
    setPreviewText(undefined);
    setPurchaseError(undefined);
    try {
      const result = await apiRequest<{ valid: boolean; reason?: string; basePrice: string; discountAmount: string; finalAmount: string; bonusUnits: number }>(
        `/promotions/promo-codes/validate/self?code=${encodeURIComponent(promoCode.trim())}&packageDefinitionId=${selectedPackageDefinitionId}`,
        { studioId },
      );
      if (!result.valid) {
        setPreviewText(result.reason ?? 'Kod geçerli değil.');
      } else if (result.bonusUnits > 0) {
        setPreviewText(`Fiyat: ${result.finalAmount} TRY, +${result.bonusUnits} ekstra hak`);
      } else {
        setPreviewText(`İndirim: ${result.discountAmount} TRY, ödenecek: ${result.finalAmount} TRY`);
      }
    } catch (e) {
      setPreviewText(e instanceof ApiError ? e.message : 'Önizleme alınamadı.');
    } finally {
      setPreviewing(false);
    }
  };

  const purchaseWithCodes = async () => {
    if (!studioId || !selectedPackageDefinitionId) return;
    setPurchasing(true);
    setPurchaseError(undefined);
    try {
      await apiRequest('/payments/checkout/self', {
        method: 'POST',
        studioId,
        body: {
          studioId,
          memberId: activeMembership?.memberProfileId,
          packageDefinitionId: selectedPackageDefinitionId,
          promoCode: promoCode.trim() || undefined,
          giftCardCode: giftCardCode.trim() || undefined,
        },
      });
      setPromoCode('');
      setGiftCardCode('');
      setPreviewText(undefined);
      await load();
    } catch (e) {
      setPurchaseError(e instanceof ApiError ? e.message : 'Satın alma tamamlanamadı.');
    } finally {
      setPurchasing(false);
    }
  };

  const cancelAtPeriodEnd = async (subscriptionId: string) => {
    if (!studioId) return;
    setCancellingId(subscriptionId);
    setError(undefined);
    try {
      await apiRequest(`/payments/subscriptions/${subscriptionId}/cancel/self`, {
        method: 'POST',
        body: { atPeriodEnd: true },
        studioId,
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Abonelik iptal edilemedi.');
    } finally {
      setCancellingId(null);
    }
  };

  const loading = payments === null && subscriptions === null && !error;

  return (
    <ScreenContainer>
      {loading ? <ActivityIndicator /> : null}

      {subscriptions && subscriptions.length > 0 ? (
        <>
          <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Aktif üyeliğim</Text>
          {subscriptions.map((sub) => (
            <View key={sub.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.cardTitle, fonts.bodyStrong, { color: c.textPrimary }]}>{sub.packageDefinitionName}</Text>
              <Text style={[styles.cardLine, fonts.body, { color: c.textSecondary }]}>
                Sonraki yenileme: {formatDate(sub.nextChargeAt)}
              </Text>
              <Text style={[styles.cardLine, fonts.body, { color: c.textMuted }]}>
                Durum: {sub.status === 'ACTIVE' ? 'Aktif' : sub.status === 'PAUSED' ? 'Durduruldu' : sub.status === 'PAST_DUE' ? 'Ödeme bekleniyor' : 'İptal edildi'}
                {sub.cancelAtPeriodEnd ? ' (dönem sonunda iptal edilecek)' : ''}
              </Text>
              {sub.status === 'ACTIVE' && !sub.cancelAtPeriodEnd ? (
                <View style={styles.cardAction}>
                  <PrimaryButton
                    label="Dönem sonunda iptal et"
                    variant="secondary"
                    loading={cancellingId === sub.id}
                    onPress={() => cancelAtPeriodEnd(sub.id)}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Ödemelerim</Text>
      {payments && payments.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>Henüz bir ödemeniz bulunmuyor.</Text>
      ) : null}
      {payments?.map((payment) => (
        <View key={payment.id} style={[styles.paymentRow, { borderColor: c.border }]}>
          <View style={styles.paymentInfo}>
            <Text style={[styles.paymentAmount, fonts.bodyStrong, { color: c.textPrimary }]}>
              {formatAmount(payment.amount, payment.currency)}
            </Text>
            <Text style={[styles.paymentMeta, fonts.body, { color: c.textMuted }]}>
              {PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod} · {formatDate(payment.paidAt)}
            </Text>
          </View>
          <Text
            style={[
              styles.paymentStatus,
              fonts.bodyStrong,
              { color: payment.paymentStatus === 'COMPLETED' ? palette.success : payment.paymentStatus === 'FAILED' ? palette.danger : c.textMuted },
            ]}
          >
            {PAYMENT_STATUS_LABELS[payment.paymentStatus] ?? payment.paymentStatus}
          </Text>
        </View>
      ))}

      {myGiftCards && myGiftCards.length > 0 ? (
        <>
          <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Hediye kartlarım</Text>
          {myGiftCards.map((card) => (
            <View key={card.id} style={[styles.paymentRow, { borderColor: c.border }]}>
              <View style={styles.paymentInfo}>
                <Text style={[styles.paymentAmount, fonts.bodyStrong, { color: c.textPrimary }]}>
                  {formatAmount(card.balance, card.currency)}
                </Text>
                <Text style={[styles.paymentMeta, fonts.body, { color: c.textMuted }]}>**** {card.last4}</Text>
              </View>
              <Text style={[styles.paymentStatus, fonts.bodyStrong, { color: card.status === 'ACTIVE' ? palette.success : c.textMuted }]}>
                {GIFT_CARD_STATUS_LABELS[card.status] ?? card.status}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Hediye kartı bakiyesi sorgula</Text>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TextField label="Hediye kartı kodu" value={checkCode} onChangeText={setCheckCode} placeholder="ORN AB3XY7Q92KLM4T6P" />
        <View style={styles.cardAction}>
          <PrimaryButton label="Bakiyeyi göster" variant="secondary" loading={checking} onPress={checkGiftCardBalance} />
        </View>
        {checkResult ? (
          <Text style={[styles.cardLine, fonts.body, { color: c.textPrimary }]}>
            **** {checkResult.last4}: {formatAmount(checkResult.balance, checkResult.currency)} ({GIFT_CARD_STATUS_LABELS[checkResult.status] ?? checkResult.status})
          </Text>
        ) : null}
        {checkError ? <Text style={[styles.cardLine, fonts.body, { color: palette.danger }]}>{checkError}</Text> : null}
      </View>

      {myPackages && myPackages.length > 0 && selectedPackageDefinitionId ? (
        <>
          <Text style={[styles.section, fonts.bodyStrong, { color: c.textSecondary }]}>Paketimi yenile</Text>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.cardLine, fonts.body, { color: c.textSecondary }]}>
              {myPackages.find((p) => p.packageDefinitionId === selectedPackageDefinitionId)?.packageDefinitionName}
            </Text>
            <TextField label="Promosyon kodu (opsiyonel)" value={promoCode} onChangeText={setPromoCode} placeholder="ORN HOSGELDIN10" />
            <TextField label="Hediye kartı kodu (opsiyonel)" value={giftCardCode} onChangeText={setGiftCardCode} placeholder="ORN AB3XY7Q92KLM4T6P" />
            <View style={styles.cardAction}>
              <PrimaryButton label="Fiyatı önizle" variant="secondary" loading={previewing} disabled={!promoCode.trim()} onPress={previewPrice} />
            </View>
            {previewText ? <Text style={[styles.cardLine, fonts.body, { color: c.textPrimary }]}>{previewText}</Text> : null}
            <View style={styles.cardAction}>
              <PrimaryButton label="Satın al" loading={purchasing} onPress={purchaseWithCodes} />
            </View>
            {purchaseError ? <Text style={[styles.cardLine, fonts.body, { color: palette.danger }]}>{purchaseError}</Text> : null}
          </View>
        </>
      ) : null}

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: typography.size.sm,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardTitle: {
    fontSize: typography.size.md,
    marginBottom: spacing[1],
  },
  cardLine: {
    fontSize: typography.size.sm,
    marginBottom: spacing[1],
  },
  cardAction: {
    marginTop: spacing[3],
  },
  empty: {
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  paymentInfo: {
    flexShrink: 1,
  },
  paymentAmount: {
    fontSize: typography.size.md,
  },
  paymentMeta: {
    fontSize: typography.size.sm,
    marginTop: spacing[1],
  },
  paymentStatus: {
    fontSize: typography.size.sm,
  },
  error: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
  },
});
