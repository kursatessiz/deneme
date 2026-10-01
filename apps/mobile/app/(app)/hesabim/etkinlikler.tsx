import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type { EventDTO, MyEventRegistrationDTO } from '@platform/shared';

import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

/** Member self-service events (G3c-1): the member's registrations and the published events open to them. */
export default function EtkinliklerScreen() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const [mine, setMine] = useState<MyEventRegistrationDTO[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const [list, regs] = await Promise.all([
        apiRequest<{ items: EventDTO[] }>(`/studios/${studioId}/events/self`, { studioId }),
        apiRequest<{ items: MyEventRegistrationDTO[] }>(`/studios/${studioId}/events/self/registrations`, { studioId }),
      ]);
      setEvents(list.items);
      setMine(regs.items.filter((r) => r.status !== 'CANCELLED'));
    } catch {
      setError(t('mEvents.loadFailed'));
    }
  }, [studioId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (eventId: string) => router.push({ pathname: '/(app)/hesabim/etkinlik', params: { eventId } });
  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {!events && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.note, { color: palette.danger }]}>{error}</Text> : null}

      {events ? (
        <>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
            {t('mEvents.myRegistrations')}
          </Text>
          {mine.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mEvents.noRegistrations')}</Text> : null}
          {mine.map((r) => (
            <Pressable key={r.id} accessibilityRole="button" onPress={() => open(r.eventId)} style={[styles.card, card, styles.bordered]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{r.eventTitle}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                {r.eventStartsAt ? formatDateTime(r.eventStartsAt, locale) : t('mEvents.noDate')}
              </Text>
              <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>{t(`mEvents.status.${r.status}`)}</Text>
            </Pressable>
          ))}

          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
            {t('mEvents.upcoming')}
          </Text>
          {events.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mEvents.empty')}</Text> : null}
          {events.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" onPress={() => open(e.id)} style={[styles.card, card, styles.bordered]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{e.title}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                {e.startsAt ? formatDateTime(e.startsAt, locale) : t('mEvents.noDate')}
                {e.occurrences.length > 1 ? ` - ${t('mEvents.sessions', { count: e.occurrences.length })}` : ''}
              </Text>
              <Text style={[styles.meta, fonts.body, { color: c.textSecondary }]}>
                {e.remainingSeats > 0
                  ? t('mEvents.seatsLeft', { count: e.remainingSeats })
                  : e.waitlistEnabled
                    ? t('mEvents.waitlistOpen')
                    : t('mEvents.full')}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  title: { fontSize: typography.size.lg, marginTop: spacing[2] },
  card: { padding: spacing[4], gap: spacing[1] },
  bordered: { borderWidth: borderWidth },
  meta: { fontSize: typography.size.sm },
  note: { fontSize: typography.size.sm },
  spacer: { height: spacing[4] },
});
