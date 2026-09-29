import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { evaluateEventRefund } from '@platform/shared';
import type { EventDTO, EventRegisterResultDTO, EventRegistrationDTO, EventTicketTypeDTO, MyEventRegistrationDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { formatDateTime, useLocale, useT } from '../../../src/i18n';
import { apiRequest } from '../../../src/lib/api';
import { eventErrorText, ticketPriceLabel } from '../../../src/lib/events';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/** One event for a member (G3c-1): sessions, tickets and registering, and the member's own registration with pay and cancel. */
export default function EtkinlikScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { activeMembership } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const studioId = activeMembership?.studioId;

  const [event, setEvent] = useState<EventDTO | null>(null);
  const [registration, setRegistration] = useState<MyEventRegistrationDTO | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studioId || !eventId) return;
    setError(undefined);
    try {
      const [detail, regs] = await Promise.all([
        apiRequest<EventDTO>(`/studios/${studioId}/events/self/${eventId}`, { studioId }),
        apiRequest<{ items: MyEventRegistrationDTO[] }>(`/studios/${studioId}/events/self/registrations`, { studioId }),
      ]);
      setEvent(detail);
      setRegistration(regs.items.find((r) => r.eventId === eventId && r.status !== 'CANCELLED') ?? null);
    } catch {
      setError(t('mEvents.loadFailed'));
    }
  }, [studioId, eventId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openPaymentLink = async (reg: EventRegistrationDTO) => {
    if (reg.paymentLink) await Linking.openURL(reg.paymentLink);
  };

  const register = async (ticket: EventTicketTypeDTO, useCredits: boolean) => {
    if (!studioId || !event) return;
    setBusyKey(`${ticket.id}:${useCredits}`);
    try {
      const result = await apiRequest<EventRegisterResultDTO>(`/studios/${studioId}/events/self/${event.id}/register`, {
        method: 'POST',
        studioId,
        body: { ticketTypeId: ticket.id, useCredits },
      });
      const reg = result.registration;
      const message = result.duplicate
        ? t('mEvents.alreadyRegistered')
        : reg.status === 'WAITLIST'
          ? t('mEvents.waitlisted')
          : reg.status === 'PENDING_PAYMENT'
            ? t('mEvents.pendingPayment')
            : t('mEvents.registered');
      Alert.alert(event.title, message);
      if (reg.status === 'PENDING_PAYMENT') await openPaymentLink(reg);
      await load();
    } catch (e) {
      Alert.alert(event.title, eventErrorText(e, t));
    } finally {
      setBusyKey(null);
    }
  };

  const pay = async () => {
    if (!studioId || !registration) return;
    setBusyKey('pay');
    try {
      const reg = await apiRequest<EventRegistrationDTO>(`/studios/${studioId}/events/self/registrations/${registration.id}/pay`, {
        method: 'POST',
        studioId,
        body: {},
      });
      await openPaymentLink(reg);
      await load();
    } catch (e) {
      Alert.alert(t('mEvents.pay'), eventErrorText(e, t));
    } finally {
      setBusyKey(null);
    }
  };

  const doCancel = async () => {
    if (!studioId || !registration) return;
    setBusyKey('cancel');
    try {
      await apiRequest(`/studios/${studioId}/events/self/registrations/${registration.id}/cancel`, { method: 'POST', studioId, body: {} });
      Alert.alert(t('mEvents.cancelConfirmTitle'), t('mEvents.cancelled'));
      await load();
    } catch (e) {
      Alert.alert(t('mEvents.cancelConfirmTitle'), eventErrorText(e, t));
    } finally {
      setBusyKey(null);
    }
  };

  const confirmCancel = () => {
    if (!event) return;
    const policy = evaluateEventRefund({
      startsAt: event.startsAt ? new Date(event.startsAt) : null,
      now: new Date(),
      fullRefundHoursBefore: event.fullRefundHoursBefore,
    });
    Alert.alert(t('mEvents.cancelConfirmTitle'), policy.refundable ? t('mEvents.cancelConfirmRefund') : t('mEvents.cancelConfirmNoRefund'), [
      { text: t('mEvents.keep'), style: 'cancel' },
      { text: t('mEvents.cancel'), style: 'destructive', onPress: doCancel },
    ]);
  };

  const card = { backgroundColor: c.surface, borderColor: c.border, borderRadius: theme.family.radii.card };
  const refundDeadline =
    event?.startsAt != null
      ? evaluateEventRefund({ startsAt: new Date(event.startsAt), now: new Date(), fullRefundHoursBefore: event.fullRefundHoursBefore }).deadline
      : null;
  const canRegister = event?.status === 'PUBLISHED' && !registration;
  const joinsWaitlist = (event?.remainingSeats ?? 0) === 0;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      {!event && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.note, { color: palette.danger }]}>{error}</Text> : null}
      {event ? (
        <>
          <Text style={[styles.heading, fonts.display, { color: c.textPrimary }]} accessibilityRole="header">
            {event.title}
          </Text>
          {event.status === 'CANCELLED' ? <Text style={[styles.note, fonts.body, { color: palette.danger }]}>{t('mEvents.eventCancelled')}</Text> : null}
          <Text style={[styles.note, fonts.body, { color: c.textSecondary }]}>
            {event.remainingSeats > 0 ? t('mEvents.seatsLeft', { count: event.remainingSeats }) : event.waitlistEnabled ? t('mEvents.waitlistOpen') : t('mEvents.full')}
          </Text>
          {refundDeadline ? (
            <Text style={[styles.note, fonts.body, { color: c.textMuted }]}>{t('mEvents.refundUntil', { date: formatDateTime(refundDeadline, locale) })}</Text>
          ) : null}

          {registration ? (
            <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
              <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{t(`mEvents.status.${registration.status}`)}</Text>
              <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{registration.ticketTypeName}</Text>
              {registration.status === 'PENDING_PAYMENT' ? (
                <PrimaryButton label={t('mEvents.pay')} loading={busyKey === 'pay'} onPress={pay} />
              ) : null}
              {registration.status === 'CONFIRMED' || registration.status === 'PENDING_PAYMENT' || registration.status === 'WAITLIST' ? (
                <PrimaryButton label={t('mEvents.cancel')} variant="secondary" loading={busyKey === 'cancel'} onPress={confirmCancel} />
              ) : null}
            </View>
          ) : null}

          {event.description ? (
            <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
              <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mEvents.description')}</Text>
              <Text style={[fonts.body, { color: c.textSecondary }]}>{event.description}</Text>
            </View>
          ) : null}

          <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
            <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mEvents.occurrences')}</Text>
            {event.occurrences.length === 0 ? <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{t('mEvents.noDate')}</Text> : null}
            {event.occurrences.map((o) => (
              <Text key={o.id} style={[fonts.body, { color: c.textSecondary }]}>
                {formatDateTime(o.startsAt, locale)}
                {o.trainerName ? ` - ${o.trainerName}` : ''}
              </Text>
            ))}
          </View>

          <View style={[styles.card, card, theme.family.cardBorder && styles.bordered]}>
            <Text style={[styles.title, fonts.display, { color: c.textPrimary }]}>{t('mEvents.tickets')}</Text>
            {event.ticketTypes
              .filter((ticket) => ticket.isActive)
              .map((ticket) => (
                <View key={ticket.id} style={[styles.ticketRow, { borderColor: c.border }]}>
                  <Text style={[fonts.bodyStrong, { color: c.textPrimary }]}>{ticket.name}</Text>
                  <Text style={[styles.meta, fonts.body, { color: c.textMuted }]}>{ticketPriceLabel(ticket, locale, t)}</Text>
                  {canRegister && ticket.onSale ? (
                    <View style={styles.actions}>
                      <PrimaryButton
                        label={joinsWaitlist ? t('mEvents.joinWaitlist') : t('mEvents.register')}
                        loading={busyKey === `${ticket.id}:false`}
                        onPress={() => register(ticket, false)}
                      />
                      {ticket.creditUnits ? (
                        <PrimaryButton
                          label={t('mEvents.payWithCredits', { units: ticket.creditUnits })}
                          variant="secondary"
                          loading={busyKey === `${ticket.id}:true`}
                          onPress={() => register(ticket, true)}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4], gap: spacing[3] },
  heading: { fontSize: typography.size.xl },
  title: { fontSize: typography.size.lg, marginBottom: spacing[1] },
  card: { padding: spacing[4], gap: spacing[2] },
  bordered: { borderWidth: 1 },
  meta: { fontSize: typography.size.sm },
  note: { fontSize: typography.size.sm },
  ticketRow: { borderBottomWidth: 1, paddingVertical: spacing[2], gap: spacing[1] },
  actions: { gap: spacing[2], marginTop: spacing[1] },
});
