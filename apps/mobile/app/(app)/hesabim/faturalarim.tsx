import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';

import type { InvoiceDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Hazırlanıyor',
  ISSUED: 'Kesildi',
  CANCELLED: 'İptal edildi',
  FAILED: 'Başarısız',
};

function formatAmount(amount: string, currency: string): string {
  const value = Number(amount);
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Member self-service invoice history ("Faturalarım"), with a link to open each issued document. */
export default function FaturalarimScreen() {
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [invoices, setInvoices] = useState<InvoiceDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const list = await apiRequest<InvoiceDTO[]>('/invoices/self', { studioId });
      setInvoices(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Faturalar yüklenemedi.');
    }
  }, [studioId]);

  useEffect(() => {
    load();
  }, [load]);

  const openInvoice = async (invoice: InvoiceDTO) => {
    setOpeningId(invoice.id);
    setError(undefined);
    try {
      // Real integrators (Parasut, eLogo, ...) return a public/pre-signed
      // document link here, opened directly. The MOCK provider used in
      // development leaves pdfUrl empty (see docs/INVOICING.md); it can
      // still be inspected from the web panel's authenticated download
      // endpoint.
      if (invoice.pdfUrl) {
        await Linking.openURL(invoice.pdfUrl);
      } else {
        setError('Bu fatura için görüntüleme bağlantısı sağlayıcı tarafından henüz sunulmuyor.');
      }
    } catch {
      setError('Fatura açılamadı.');
    } finally {
      setOpeningId(null);
    }
  };

  const loading = invoices === null && !error;

  return (
    <ScreenContainer>
      {loading ? <ActivityIndicator /> : null}

      {invoices && invoices.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: c.textMuted }]}>Henüz bir faturanız bulunmuyor.</Text>
      ) : null}

      {invoices?.map((invoice) => (
        <View key={invoice.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.number, fonts.bodyStrong, { color: c.textPrimary }]}>{invoice.number}</Text>
            <Text
              style={[
                styles.status,
                fonts.bodyStrong,
                {
                  color:
                    invoice.status === 'ISSUED'
                      ? palette.success
                      : invoice.status === 'FAILED'
                        ? palette.danger
                        : c.textMuted,
                },
              ]}
            >
              {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
            </Text>
          </View>
          <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{formatDate(invoice.issueDate)}</Text>
          <Text style={[styles.amount, fonts.bodyStrong, { color: c.textPrimary }]}>
            {formatAmount(invoice.total, invoice.currency)}
          </Text>
          {invoice.status === 'ISSUED' ? (
            <View style={styles.cardAction}>
              <PrimaryButton label="Faturayı görüntüle" loading={openingId === invoice.id} onPress={() => openInvoice(invoice)} />
            </View>
          ) : null}
        </View>
      ))}

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: typography.size.sm,
    marginBottom: spacing[3],
  },
  card: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  number: {
    fontSize: typography.size.md,
  },
  status: {
    fontSize: typography.size.sm,
  },
  meta: {
    fontSize: typography.size.sm,
    marginTop: spacing[1],
  },
  amount: {
    fontSize: typography.size.lg,
    marginTop: spacing[2],
  },
  cardAction: {
    marginTop: spacing[3],
  },
  error: {
    fontSize: typography.size.sm,
    marginTop: spacing[3],
  },
});
