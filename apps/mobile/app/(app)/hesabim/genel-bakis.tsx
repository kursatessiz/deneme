import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDashboardWidget, resolveWidgetPeriod } from '@platform/shared';
import type { DashboardLayoutItem } from '@platform/shared';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { PermissionGate } from '../../../src/components/PermissionGate';
import { Skeleton } from '../../../src/components/Skeleton';
import { Text } from '../../../src/components/Text';
import { DraggableCard } from '../../../src/dashboard/DraggableCard';
import { TrashTarget } from '../../../src/dashboard/TrashTarget';
import { useDashboardBoard } from '../../../src/dashboard/useDashboardBoard';
import { WidgetBody } from '../../../src/dashboard/widgets';
import { useT } from '../../../src/i18n';
import { UNDO_WINDOW_MS, removeCard, restoreCard, singleColumnItems } from '../../../src/lib/dashboardBoard';
import type { Rect } from '../../../src/lib/dashboardBoard';
import { useSession } from '../../../src/lib/session';
import { borderWidth, radii, spacing, typography, useTheme, useThemeFonts } from '../../../src/theme';

/**
 * Staff overview board: the same cards as the web overview, in one column
 * in the engine's single column order. A card is removed by holding it,
 * dragging it onto the trash can and releasing there; the board offers an
 * undo for a few seconds. Adding and resizing cards stay on the web.
 */
function Board() {
  const t = useT();
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const { activeStudioId } = useSession();
  const board = useDashboardBoard(activeStudioId);

  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [undo, setUndo] = useState<DashboardLayoutItem | null>(null);
  const trashRect = useRef<Rect | null>(null);

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const titleOf = useCallback((item: DashboardLayoutItem) => t(getDashboardWidget(item.widget).titleKey), [t]);

  const handleRemove = useCallback(
    (id: string) => {
      setDragging(false);
      setOverTrash(false);
      const result = removeCard(board.items, id);
      if (!result) return;
      board.update(result.next);
      setUndo(result.removed);
      AccessibilityInfo.announceForAccessibility(t('dashboard.announce.removed', { title: titleOf(result.removed) }));
    },
    [board, t, titleOf],
  );

  const handleUndo = () => {
    if (!undo) return;
    board.update(restoreCard(board.items, undo));
    AccessibilityInfo.announceForAccessibility(t('dashboard.announce.restored', { title: titleOf(undo) }));
    setUndo(null);
  };

  const handleCancel = useCallback(() => {
    setDragging(false);
    setOverTrash(false);
  }, []);

  const confirmReset = () => {
    Alert.alert(t('dashboard.reset.title'), t('dashboard.reset.body'), [
      { text: t('dashboard.remove.cancel'), style: 'cancel' },
      {
        text: t('dashboard.reset.confirm'),
        style: 'destructive',
        onPress: () => {
          setUndo(null);
          void board.reset();
        },
      },
    ]);
  };

  const refresh = async () => {
    setRefreshing(true);
    await board.reload();
    setRefreshing(false);
  };

  const ordered = singleColumnItems(board.items);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['left', 'right', 'bottom']}>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.top}>
          <Text style={[styles.subtitle, fonts.body, { color: c.textSecondary }]}>{t('screens.dashboard.subtitle')}</Text>
          {board.status === 'ready' && board.customized ? <Button compact variant="outline" tone="surface" label={t('dashboard.actions.reset')} onPress={confirmReset} /> : null}
        </View>

        {board.saveFailed ? <Text style={[styles.notice, fonts.bodyMedium, { color: theme.roles.error }]}>{t('dashboard.toast.saveFailed')}</Text> : null}

        {board.status === 'loading' ? (
          <View style={styles.skeletons}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={spacing[16]} />
            ))}
          </View>
        ) : null}

        {board.status === 'error' ? (
          <View style={styles.centered}>
            <Text style={[styles.notice, fonts.body, { color: theme.roles.error }]}>{t('dashboard.state.layoutError')}</Text>
            <Button compact variant="outline" tone="surface" label={t('dashboard.state.retry')} onPress={() => void board.reload()} />
          </View>
        ) : null}

        {board.status === 'forbidden' ? <EmptyState title={t('dashboard.state.noAccess')} description={t('dashboard.state.noAccessHint')} /> : null}

        {board.status === 'ready' && ordered.length === 0 ? (
          <EmptyState title={t('dashboard.empty.board')} action={<Button compact variant="outline" tone="surface" label={t('dashboard.actions.reset')} onPress={confirmReset} />} />
        ) : null}

        {board.status === 'ready'
          ? ordered.map((item) => {
              const period = resolveWidgetPeriod(item.widget, item.settings);
              return (
                <DraggableCard
                  key={item.id}
                  id={item.id}
                  title={titleOf(item)}
                  caption={period ? t(`dashboard.period.${period}`) : null}
                  trashRect={trashRect}
                  hint={t('mDashboard.card.hint')}
                  removeLabel={t('dashboard.card.remove')}
                  liftedAnnouncement={t('mDashboard.card.dragging', { title: titleOf(item) })}
                  onLift={() => setDragging(true)}
                  onHover={setOverTrash}
                  onCancel={handleCancel}
                  onRemove={handleRemove}
                >
                  <WidgetBody item={item} state={board.dataOf(item)} />
                </DraggableCard>
              );
            })
          : null}
      </ScrollView>

      {dragging ? <TrashTarget active={overTrash} label={t('mDashboard.trash.label')} onMeasure={(rect) => (trashRect.current = rect)} /> : null}

      {undo && !dragging ? (
        <View style={[styles.undo, { backgroundColor: c.surface, borderColor: c.border, borderRadius: radii.md }]} accessibilityLiveRegion="polite">
          <Text style={[styles.undoText, fonts.bodyMedium, { color: c.textPrimary }]}>{t('dashboard.toast.removed')}</Text>
          <Button compact variant="soft" label={t('dashboard.toast.undo')} onPress={handleUndo} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function GenelBakisScreen() {
  return (
    <PermissionGate anyOf={['dashboard.view']}>
      <Board />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing[4], paddingBottom: spacing[16], gap: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], marginBottom: spacing[3] },
  subtitle: { flex: 1, fontSize: typography.size.sm },
  notice: { fontSize: typography.size.sm, marginBottom: spacing[3] },
  skeletons: { gap: spacing[3] },
  centered: { alignItems: 'flex-start', gap: spacing[2] },
  undo: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    bottom: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    padding: spacing[3],
    borderWidth: borderWidth,
  },
  undoText: { flex: 1, fontSize: typography.size.sm },
});
