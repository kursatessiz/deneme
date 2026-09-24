import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import type { BranchDTO } from '@platform/shared';

import { ChoiceRow } from '../../../src/components/ChoiceRow';
import { ScreenContainer } from '../../../src/components/ScreenContainer';
import { ApiError, apiRequest } from '../../../src/lib/api';
import { useSession } from '../../../src/lib/session';
import { palette, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/** A member picks the branch they usually attend; they can still book any branch. */
export default function AnaSubeScreen() {
  const { activeMembership, refreshUser } = useSession();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const studioId = activeMembership?.studioId;
  const [branches, setBranches] = useState<BranchDTO[] | null>(null);
  const [selected, setSelected] = useState<string | null>(activeMembership?.homeBranchId ?? null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!studioId) return;
    apiRequest<BranchDTO[]>(`/branches/studio/${studioId}`)
      .then(setBranches)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Şubeler yüklenemedi.'));
  }, [studioId]);

  const choose = async (branchId: string | null) => {
    const previous = selected;
    setSelected(branchId);
    setError(undefined);
    try {
      await apiRequest(`/members/self/home-branch`, { method: 'PUT', body: { branchId }, studioId });
      await refreshUser();
    } catch (e) {
      setSelected(previous);
      setError(e instanceof ApiError ? e.message : 'Ana şube kaydedilemedi.');
    }
  };

  return (
    <ScreenContainer>
      <Text style={[styles.lead, fonts.body, { color: theme.colors.textSecondary }]}>
        Takvim ve bildirimlerde önce bu şube gösterilir. Diğer şubelerden de rezervasyon yapabilirsiniz.
      </Text>
      {!branches && !error ? <ActivityIndicator /> : null}
      {branches?.map((b) => (
        <ChoiceRow
          key={b.id}
          label={b.name}
          description={b.address ?? undefined}
          selected={selected === b.id}
          onPress={() => choose(b.id)}
        />
      ))}
      {branches ? <ChoiceRow label="Belirtmek istemiyorum" selected={selected === null} onPress={() => choose(null)} /> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  error: { fontSize: typography.size.sm, marginTop: spacing[3] },
});
