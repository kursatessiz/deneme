import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { MemberDetailDTO } from '@platform/shared';

import { MemberCard } from '../../../../src/components/MemberCard';
import { PermissionGate } from '../../../../src/components/PermissionGate';
import { PrimaryButton } from '../../../../src/components/PrimaryButton';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../../src/lib/api';
import { isTabletWidth } from '../../../../src/lib/layout';
import { useSession } from '../../../../src/lib/session';
import { palette, radii, spacing, typography, useThemeColors, useThemeFonts } from '../../../../src/theme';
import { TextField } from '../../../../src/components/TextField';

function MemberListContent() {
  const router = useRouter();
  const colors = useThemeColors();
  const fonts = useThemeFonts();
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const { activeMembership } = useSession();
  const studioId = activeMembership?.studioId;
  const canInvite = activeMembership?.permissions.includes('members.manage') ?? false;

  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<MemberDetailDTO[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      if (!studioId) return;
      setError(undefined);
      try {
        const qs = query ? `?search=${encodeURIComponent(query)}` : '';
        const data = await apiRequest<MemberDetailDTO[]>(`/members/studio/${studioId}${qs}`, { studioId });
        setMembers(data);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Üyeler yüklenemedi.');
      }
    },
    [studioId],
  );

  useEffect(() => {
    const handle = setTimeout(() => load(search), 300);
    return () => clearTimeout(handle);
  }, [search, load]);

  const openMember = (memberId: string) => {
    if (isTablet) {
      setSelectedId(memberId);
    } else {
      router.push({ pathname: '/(app)/hesabim/uyeler/[memberId]', params: { memberId } });
    }
  };

  const list = (
    <View style={isTablet ? styles.listPane : undefined}>
      <TextField label="Üye ara" value={search} onChangeText={setSearch} placeholder="Ad, soyad veya telefon" />
      {canInvite ? (
        <View style={styles.inviteButton}>
          <PrimaryButton label="Yeni üye davet et" onPress={() => router.push('/(app)/hesabim/uyeler/yeni')} />
        </View>
      ) : null}
      {!members && !error ? <ActivityIndicator /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      {members?.length === 0 ? (
        <Text style={[styles.empty, fonts.body, { color: colors.textSecondary }]}>Üye bulunamadı.</Text>
      ) : null}
      {members?.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          accessibilityLabel={`${m.firstName} ${m.lastName}`}
          onPress={() => openMember(m.id)}
          style={[
            styles.row,
            {
              borderColor: colors.border,
              backgroundColor: selectedId === m.id ? colors.surfaceMuted : colors.surface,
            },
          ]}
        >
          <Text style={[styles.rowTitle, fonts.bodyStrong, { color: colors.textPrimary }]} numberOfLines={1}>
            {m.firstName} {m.lastName}
          </Text>
          {m.phone ? <Text style={[styles.rowMeta, fonts.body, { color: colors.textSecondary }]}>{m.phone}</Text> : null}
          {m.isPartnerGuest ? (
            <Text style={[styles.rowMeta, fonts.body, { color: colors.textMuted }]}>Partner misafiri</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );

  if (!isTablet) {
    return <ScreenContainer>{list}</ScreenContainer>;
  }

  return (
    <View style={styles.tabletWrap}>
      <ScreenContainer>{list}</ScreenContainer>
      <View style={[styles.detailPane, { borderColor: colors.border }]}>
        {selectedId ? (
          <ScreenContainer>
            <MemberCard memberId={selectedId} />
          </ScreenContainer>
        ) : (
          <View style={styles.placeholder}>
            <Text style={[fonts.body, { color: colors.textSecondary }]}>Bir üye seçin.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Staff member search and list; tablet uses a list + member-card two-pane layout. */
export default function UyelerScreen() {
  return (
    <PermissionGate anyOf={['members.view']}>
      <MemberListContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  tabletWrap: { flex: 1, flexDirection: 'row' },
  listPane: { width: '100%' },
  detailPane: { flex: 1, borderLeftWidth: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inviteButton: { marginBottom: spacing[4] },
  row: {
    minHeight: 56,
    padding: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing[2],
  },
  rowTitle: { fontSize: typography.size.md },
  rowMeta: { fontSize: typography.size.sm },
  empty: { fontSize: typography.size.sm, marginTop: spacing[4] },
  error: { fontSize: typography.size.sm, marginBottom: spacing[3] },
});
