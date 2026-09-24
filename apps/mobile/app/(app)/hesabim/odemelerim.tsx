import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { MemberSubscriptionDTO, PaymentDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

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
  const [error, setError] = useState<string | undefined>();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [paymentList, subscriptionList] = await Promise.all([
        apiRequest<PaymentDTO[]>('/payments/self', { studioId }),
        apiRequest<MemberSubscriptionDTO[]>('/payments/subscriptions/self', { studioId }),
      ]);
      setPayments(paymentList);
      setSubscriptions(subscriptionList);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ödemeler yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

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
