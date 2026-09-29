import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { EventDTO, EventRegistrationDTO } from '@platform/shared';

import { PermissionGate } from '../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { apiRequest } from '../../../src/lib/api';
import { eventErrorText } from '../../../src/lib/events';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

const DOOR_STATUSES = new Set(['CONFIRMED', 'ATTENDED', 'NO_SHOW', 'PENDING_PAYMENT']);

/** Staff door check-in for events (G3c-1): pick a published event, then check people in one tap each. */
function EtkinlikGirisiContent() {
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const [selected, setSelected] = useState<EventDTO | null>(null);
  const [registrations, setRegistrations] = useState<EventRegistrationDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!studioId) return;
    setError(undefined);
    try {
      const res = await apiRequest<{ items: EventDTO[] }>(`/studios/${studioId}/events?status=PUBLISHED`, { studioId });
      setEvents(res.items);
    } catch {
      setError(t('mEvents.loadFailed'));
    }
  }, [studioId, t]);

  const loadRegistrations = useCallback(async () => {
    if (!studioId || !selected) return;
    try {
      const res = await apiRequest<{ items: EventRegistrationDTO[] }>(`/studios/${studioId}/events/${selected.id}/registrations`, { studioId });
      setRegistrations(res.items.filter((r) => DOOR_STATUSES.has(r.status)));
    } catch {
      setError(t('mEvents.loadFailed'));
    }
  }, [studioId, selected, t]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setRegistrations(null);
    loadRegistrations();
  }, [loadRegistrations]);

  const checkIn = async (reg: EventRegistrationDTO) => {
    if (!studioId) return;
    setBusyId(reg.id);
    try {
      const updated = await apiRequest<EventRegistrationDTO>(`/studios/${studioId}/events/registrations/${reg.id}/check-in`, { method: 'POST', studioId });
      setRegistrations((list) => (list ?? []).map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      Alert.alert(t('mEvents.checkin.title'), eventErrorText(e, t));
    } finally {
      setBusyId(null);
    }
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };
  const attended = (registrations ?? []).filter((r) => r.status === 'ATTENDED').length;

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await (selected ? loadRegistrations() : loadEvents());
            setRefreshing(false);
          }}
        />
      }
    >
      {error ? <Text style={[styles.note, { color: palette.danger }]}>{error}</Text> : null}

      {!selected ? (
        <>
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
            {t('mEvents.checkin.pickEvent')}
          </Text>
          {!events && !error ? <ActivityIndicator /> : null}
          {events && events.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mEvents.checkin.noEvents')}</Text> : null}
          {(events ?? []).map((e) => (
            <Pressable key={e.id} accessibilityRole="button" onPress={() => setSelected(e)} style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{e.title}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{e.startsAt ? formatDateTime(e.startsAt, locale) : t('mEvents.noDate')}</Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <PrimaryButton label={t('mEvents.checkin.back')} variant="secondary" onPress={() => setSelected(null)} />
          <Text style={[styles.title, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
            {selected.title}
          </Text>
          {!registrations ? <ActivityIndicator /> : null}
          {registrations ? (
            <Text style={[styles.note, fonts.body, { color: c.textSecondary }]}>{t('mEvents.checkin.count', { attended, total: registrations.length })}</Text>
          ) : null}
          {registrations && registrations.length === 0 ? <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mEvents.checkin.empty')}</Text> : null}
          {(registrations ?? []).map((r) => (
            <View key={r.id} style={[styles.row, card, theme.family.cardBorder && styles.bordered]}>
              <View style={styles.rowText}>
                <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{r.displayName}</Text>
                <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>
                  {r.ticketTypeName} - {t(`mEvents.status.${r.status}`)}
                </Text>
              </View>
              {r.status === 'ATTENDED' ? (
                <Text style={[fonts.bodyStrong, { color: c.textSecondary }]}>{t('mEvents.checkin.checkedIn')}</Text>
              ) : r.status === 'CONFIRMED' || r.status === 'NO_SHOW' ? (
                <PrimaryButton label={t('mEvents.checkin.checkIn')} loading={busyId === r.id} onPress={() => checkIn(r)} />
              ) : null}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

export default function EtkinlikGirisiScreen() {
  return (
    <PermissionGate anyOf={['events.checkin']}>
      <EtkinlikGirisiContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  title: { fontSize: typography.size.lg },
  card: { padding: spacing[4], gap: spacing[1] },
  bordered: { borderWidth: 1 },
  meta: { fontSize: typography.size.sm },
  note: { fontSize: typography.size.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], padding: spacing[3] },
  rowText: { flex: 1, gap: 2 },
});
