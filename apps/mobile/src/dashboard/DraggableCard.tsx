import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';

import { Card } from '../components/Card';
import { Text } from '../components/Text';
import { LONG_PRESS_MOVE_SLOP, LONG_PRESS_MS, dropOutcome, isOverTrash } from '../lib/dashboardBoard';
import type { Rect, TabletFrame } from '../lib/dashboardBoard';
import { spacing, typography, useTheme, useThemeFonts } from '../theme';

/** Scale of a lifted card. */
const LIFT_SCALE = 1.03;

export interface DraggableCardProps {
  id: string;
  title: string;
  /** Period caption under the title, if the card has one. */
  caption?: string | null;
  /** Window rect of the trash target; null until it is measured. */
  trashRect: React.MutableRefObject<Rect | null>;
  /** Accessibility hint of the title row (how to remove with touch). */
  hint: string;
  /** Label of the screen reader "remove" action. */
  removeLabel: string;
  /** Spoken when the card is lifted. */
  liftedAnnouncement: string;
  /** The finger came down long enough: the card lifted and the trash target should show. */
  onLift: (id: string) => void;
  /** The finger moved over or off the trash target. */
  onHover: (over: boolean) => void;
  /** The drag ended without removing (released elsewhere or interrupted). */
  onCancel: (id: string) => void;
  /** Released over the trash target, or the screen reader's remove action. */
  onRemove: (id: string) => void;
  /** Absolute frame on the tablet board; omitted on phones, where the card is full width and as tall as its content. */
  frame?: TabletFrame;
  children: ReactNode;
}

/**
 * One overview card with the long-press-to-trash gesture. Everything runs
 * on one PanResponder: a touch starts a timer, moving before it fires hands
 * the touch back (so the list scrolls), and once the card is lifted the
 * responder is not given up until release. Only React Native's own
 * PanResponder and Animated are used.
 */
export function DraggableCard({ id, title, caption, trashRect, hint, removeLabel, liftedAnnouncement, onLift, onHover, onCancel, onRemove, frame, children }: DraggableCardProps) {
  const { theme } = useTheme();
  const fonts = useThemeFonts();
  const c = theme.colors;
  const [lifted, setLifted] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const phase = useRef<'idle' | 'pending' | 'lifted'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef(false);
  const latest = useRef({ id, liftedAnnouncement, onLift, onHover, onCancel, onRemove });
  latest.current = { id, liftedAnnouncement, onLift, onHover, onCancel, onRemove };

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const setOver = useCallback((next: boolean) => {
    if (over.current === next) return;
    over.current = next;
    latest.current.onHover(next);
  }, []);

  const springBack = useCallback(() => {
    Animated.parallel([
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 6 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
    ]).start(() => setLifted(false));
  }, [pan, scale]);

  const finish = useCallback(
    (gesture: PanResponderGestureState | null) => {
      clearTimer();
      const wasLifted = phase.current === 'lifted';
      phase.current = 'idle';
      if (!wasLifted) return;
      const overTrash = gesture ? isOverTrash({ x: gesture.moveX, y: gesture.moveY }, trashRect.current) : false;
      setOver(false);
      if (dropOutcome(overTrash) === 'remove') {
        // Shrink into the trash, then let the screen drop the card.
        Animated.parallel([
          Animated.timing(scale, { toValue: 0.4, duration: 140, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
        ]).start(() => latest.current.onRemove(latest.current.id));
      } else {
        springBack();
        latest.current.onCancel(latest.current.id);
      }
    },
    [clearTimer, opacity, scale, setOver, springBack, trashRect],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          clearTimer();
          phase.current = 'pending';
          timer.current = setTimeout(() => {
            timer.current = null;
            if (phase.current !== 'pending') return;
            phase.current = 'lifted';
            setLifted(true);
            Animated.spring(scale, { toValue: LIFT_SCALE, useNativeDriver: true }).start();
            latest.current.onLift(latest.current.id);
            AccessibilityInfo.announceForAccessibility(latest.current.liftedAnnouncement);
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          if (phase.current === 'pending') {
            // A swipe before the hold completes is a scroll, not a lift.
            if (Math.hypot(g.dx, g.dy) > LONG_PRESS_MOVE_SLOP) {
              clearTimer();
              phase.current = 'idle';
            }
            return;
          }
          if (phase.current !== 'lifted') return;
          pan.setValue({ x: g.dx, y: g.dy });
          setOver(isOverTrash({ x: g.moveX, y: g.moveY }, trashRect.current));
        },
        // Once lifted the card keeps the touch; before that the list may scroll.
        onPanResponderTerminationRequest: () => phase.current !== 'lifted',
        onPanResponderRelease: (_e, g) => finish(g),
        onPanResponderTerminate: () => finish(null),
      }),
    [clearTimer, finish, pan, scale, setOver, trashRect],
  );

  const remove = () => {
    onRemove(id);
  };

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.wrap,
        frame && { position: 'absolute', left: frame.left, top: frame.top, width: frame.width, height: frame.height, marginBottom: 0 },
        lifted && styles.lifted,
        lifted && { shadowColor: c.textPrimary },
        { opacity, transform: [...pan.getTranslateTransform(), { scale }] },
      ]}
    >
      <Card
        style={[frame ? styles.fill : null, lifted ? { borderColor: c.primary } : null]}
        header={
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={caption ? `${title}, ${caption}` : title}
            accessibilityHint={hint}
            accessibilityActions={[{ name: 'remove', label: removeLabel }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'remove') remove();
            }}
          >
            <Text style={[styles.title, fonts.bodyStrong, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            {caption ? <Text style={[styles.caption, fonts.body, { color: c.textMuted }]}>{caption}</Text> : null}
          </View>
        }
      >
        {children}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing[3] },
  // A lifted card rises above its siblings (zIndex) and casts a soft shadow (elevation on Android).
  lifted: {
    zIndex: 10,
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: spacing[3],
    shadowOffset: { width: 0, height: spacing[1] },
  },
  fill: { flex: 1 },
  title: { fontSize: typography.size.sm },
  caption: { fontSize: typography.size.xs },
});
