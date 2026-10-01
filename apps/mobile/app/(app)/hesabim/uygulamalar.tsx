import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { localizedText } from '@platform/shared';
import type { StudioAddOnDTO, StudioAddOnListDTO } from '@platform/shared';

import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { formatDate, useLocale, useT } from '../../../src/i18n';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { borderWidth, palette, radii, spacing, typography, useThemeColors } from '../../../src/theme';
import { Text } from '../../../src/components/Text';

/**
 * Read-only list of the studio's add-ons (G5c-2): the ones that are active or
 * being tried, with days left or the renewal date. Buying, activating and
 * cancelling happen on the web (deep link below); this screen never charges.
 */
export default function UygulamalarScreen() {
  const colors = useThemeColors();
  const t = useT();
  const { locale } = useLocale();
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canView = activeMembership?.permissions.includes('billing.manage') ?? false;

  const [list, setList] = useState<StudioAddOnListDTO | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!studioId) return;
    setLoadError(undefined);
    try {
      setList(await apiRequest<StudioAddOnListDTO>(`/studios/${studioId}/add-ons`, { studioId }));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('mAddOns.loadFailed'));
    }
  }, [studioId, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) return <Redirect href="/(app)/hesabim" />;

  const visible: StudioAddOnDTO[] = (list?.items ?? []).filter((i) => i.hasAccess && (i.state === 'TRIALING' || i.state === 'ACTIVE' || i.state === 'CANCELLED'));

  const openWeb = async () => {
    if (!list || !list.manageUrl.startsWith('https://')) return;
    try {
      await Linking.openURL(list.manageUrl);
    } catch {
      setLoadError(t('mAddOns.loadFailed'));
    }
  };

  const detail = (item: StudioAddOnDTO): string => {
    if (item.state === 'TRIALING' && item.trialDaysLeft !== null) return t('mAddOns.trialLeft', { count: item.trialDaysLeft });
    if (item.state === 'CANCELLED' && item.currentPeriodEnd) return t('mAddOns.accessUntil', { date: formatDate(item.currentPeriodEnd, locale, { dateStyle: 'medium' }) });
    if (item.currentPeriodEnd) return t('mAddOns.renews', { date: formatDate(item.currentPeriodEnd, locale, { dateStyle: 'medium' }) });
    return '';
  };

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mAddOns.title')}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{t('mAddOns.intro')}</Text>

      {!list && !loadError && <ActivityIndicator color={colors.primary} />}
      {loadError && <Text style={{ color: palette.danger }}>{loadError}</Text>}
      {list && visible.length === 0 && <Text style={{ color: colors.textSecondary }}>{t('mAddOns.empty')}</Text>}

      {visible.map((item) => (
        <View key={item.key} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.rowHeader}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{localizedText(item.name, locale)}</Text>
            <Text style={[styles.state, { color: colors.textSecondary }]}>{t(`mAddOns.state.${item.state === 'TRIALING' || item.state === 'CANCELLED' ? item.state : 'ACTIVE'}`)}</Text>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: typography.size.sm }}>{detail(item)}</Text>
        </View>
      ))}

      {list && <PrimaryButton label={t('mAddOns.openWeb')} onPress={openWeb} />}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, marginBottom: spacing[2] },
  description: { fontSize: typography.size.sm, marginBottom: spacing[4] },
  row: { borderWidth: borderWidth, borderRadius: radii.md, padding: spacing[3], marginBottom: spacing[3] },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing[1] },
  name: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  state: { fontSize: typography.size.sm },
});
