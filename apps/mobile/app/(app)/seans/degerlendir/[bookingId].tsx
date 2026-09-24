import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RateBookingResultDTO } from '@platform/shared';

import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { useSession } from '../../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../../src/theme';

const SCORE_SIZE = 56; // >= 44pt touch target

const SCORE_LABELS = ['Çok kötü', 'Kötü', 'Orta', 'İyi', 'Harika'];

/** Post-class rating screen: five large score targets and an optional comment. */
export default function RateSessionScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<RateBookingResultDTO | null>(null);

  const submit = async () => {
    if (!studioId || !bookingId || score === null) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await apiRequest<RateBookingResultDTO>(`/ratings/studio/${studioId}/bookings/${bookingId}`, {
        method: 'POST',
        body: { score, comment: comment.trim() || undefined },
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Değerlendirme gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const openGoogleReview = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Bağlantı açılamadı', 'Google yorum sayfası açılamadı.');
    }
  };

  if (result) {
    return (
      <ScreenContainer>
        <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Teşekkürler!</Text>
        <Text style={[styles.subtitle, fonts.body, { color: c.textSecondary }]}>Değerlendirmeniz kaydedildi.</Text>

        {result.reviewPrompt ? (
          <View style={[styles.reviewCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card }]}>
            <Text style={[styles.reviewTitle, fonts.bodyStrong, { color: c.textPrimary }]}>
              Deneyiminizi başkalarıyla da paylaşmak ister misiniz?
            </Text>
            <Text style={[styles.reviewSubtitle, fonts.body, { color: c.textSecondary }]}>
              İsterseniz Google üzerinden kısa bir yorum bırakabilirsiniz. Tamamen isteğe bağlıdır.
            </Text>
            <PrimaryButton label="Google'da yorum bırak" onPress={() => openGoogleReview(result.reviewPrompt!.googleReviewUrl)} variant="secondary" />
          </View>
        ) : null}

        <PrimaryButton label="Bitti" onPress={() => router.back()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>Seansını nasıl buldun?</Text>

      <View style={styles.scoreRow}>
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = score === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`${value} yıldız: ${SCORE_LABELS[value - 1]}`}
              accessibilityState={{ selected }}
              onPress={() => setScore(value)}
              style={[
                styles.scoreButton,
                {
                  borderColor: selected ? theme.colors.primary : c.border,
                  backgroundColor: selected ? theme.colors.primary : c.surface,
                  borderRadius: theme.family.radii.button,
                },
              ]}
            >
              <Text style={[styles.scoreValue, fonts.display, { color: selected ? '#ffffff' : c.textPrimary }]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
      {score !== null ? (
        <Text style={[styles.scoreLabel, fonts.body, { color: c.textSecondary }]}>{SCORE_LABELS[score - 1]}</Text>
      ) : null}

      <Text style={[styles.fieldLabel, fonts.bodyStrong, { color: c.textPrimary }]}>Yorum (opsiyonel)</Text>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Deneyiminizi anlatın..."
        placeholderTextColor={c.textMuted}
        multiline
        maxLength={1000}
        style={[styles.commentInput, { borderColor: c.border, color: c.textPrimary, borderRadius: theme.family.radii.card }]}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <PrimaryButton label="Gönder" onPress={submit} disabled={score === null} loading={submitting} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, marginBottom: spacing[4] },
  subtitle: { fontSize: typography.size.md, marginBottom: spacing[5] },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing[2] },
  scoreButton: {
    width: SCORE_SIZE,
    height: SCORE_SIZE,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: { fontSize: typography.size.lg },
  scoreLabel: { fontSize: typography.size.sm, marginBottom: spacing[5], textAlign: 'center' },
  fieldLabel: { fontSize: typography.size.md, marginBottom: spacing[2] },
  commentInput: {
    borderWidth: 1,
    minHeight: 100,
    padding: spacing[3],
    fontSize: typography.size.md,
    marginBottom: spacing[5],
    textAlignVertical: 'top',
  },
  reviewCard: { borderWidth: 1, padding: spacing[4], gap: spacing[3], marginBottom: spacing[5] },
  reviewTitle: { fontSize: typography.size.md },
  reviewSubtitle: { fontSize: typography.size.sm },
  errorText: { color: palette.danger, fontSize: typography.size.sm, marginBottom: spacing[3] },
});
