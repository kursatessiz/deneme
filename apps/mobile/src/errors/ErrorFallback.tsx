import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';

import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator, radii, resolveTheme, spacing, typography } from '@platform/shared';
import type { Translate } from '@platform/shared';

import { resolveOfflineTranslate } from '../i18n/offlineTranslate';
import { reportErrorWithId, sendErrorFeedback } from './runtime';
import { FEEDBACK_MAX_LENGTH } from './reporterCore';
import type { FeedbackResult } from './reporterCore';

interface ErrorFallbackProps {
  error: unknown;
  onRetry: () => void;
}

const BASE_TRANSLATE: Translate = createTranslator({
  locale: BASE_LOCALE,
  messages: BUNDLED_MESSAGES[BASE_LOCALE],
  fallback: BUNDLED_MESSAGES[BASE_LOCALE],
});

/**
 * The friendly error screen (H2): reports the error (once per error object)
 * and shows the short user-facing code, the same 8-character code the web
 * shows. It must work when the providers themselves failed, so it reads the
 * theme through resolveTheme() and translations from the bundled catalogue
 * directly instead of the React contexts.
 */
export function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const scheme = useColorScheme();
  const theme = useMemo(() => resolveTheme({ tenant: null, appearance: null, systemMode: scheme === 'dark' ? 'dark' : 'light' }), [scheme]);
  const [t, setT] = useState<Translate>(() => BASE_TRANSLATE);
  const [code, setCode] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<FeedbackResult | 'idle' | 'sending'>('idle');

  useEffect(() => {
    const reported = reportErrorWithId(error, { severity: 'fatal' });
    setCode(reported.code);
    setEventId(reported.eventId);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    resolveOfflineTranslate().then(
      (translate) => {
        if (!cancelled) setT(() => translate);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const { colors } = theme;
  const submitNote = async () => {
    if (!eventId) return;
    setNoteState('sending');
    setNoteState(await sendErrorFeedback(eventId, note));
  };
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} accessibilityRole="alert">
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t('mErrors.boundary.title')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t('mErrors.boundary.description')}</Text>
      {code ? (
        <View style={styles.codeBlock}>
          <Text selectable style={[styles.code, { color: colors.textPrimary }]}>
            {t('mErrors.boundary.code', { code })}
          </Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mErrors.boundary.codeHint')}</Text>
        </View>
      ) : null}
      {eventId ? (
        <View style={styles.feedback}>
          {noteState === 'sent' ? (
            <Text accessibilityRole="text" style={[styles.hint, { color: colors.textSecondary }]}>
              {t('mErrors.feedback.sent')}
            </Text>
          ) : (
            <>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mErrors.feedback.label')}</Text>
              <TextInput
                accessibilityLabel={t('mErrors.feedback.label')}
                value={note}
                onChangeText={setNote}
                maxLength={FEEDBACK_MAX_LENGTH}
                multiline
                numberOfLines={3}
                placeholder={t('mErrors.feedback.placeholder')}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.md }]}
              />
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('mErrors.feedback.counter', { count: note.length, max: FEEDBACK_MAX_LENGTH })}</Text>
              {noteState === 'failed' ? <Text style={[styles.hint, { color: colors.textPrimary }]}>{t('mErrors.feedback.failed')}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mErrors.feedback.submit')}
                disabled={noteState === 'sending' || note.trim().length === 0}
                onPress={submitNote}
                style={[styles.noteButton, { borderColor: colors.border, borderRadius: radii.md }]}
              >
                <Text style={[styles.noteButtonLabel, { color: colors.textPrimary }]}>{t('mErrors.feedback.submit')}</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mErrors.boundary.retry')}
        onPress={onRetry}
        style={[styles.button, { backgroundColor: colors.primary, borderRadius: radii.md }]}
      >
        <Text style={[styles.buttonLabel, { color: colors.onPrimary }]}>{t('mErrors.boundary.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[3],
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.size.md,
    textAlign: 'center',
  },
  codeBlock: {
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  code: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  hint: {
    fontSize: typography.size.sm,
    textAlign: 'center',
  },
  feedback: {
    alignSelf: 'stretch',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  input: {
    minHeight: 72,
    borderWidth: 1,
    padding: spacing[3],
    fontSize: typography.size.md,
    textAlignVertical: 'top',
  },
  noteButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: spacing[5],
  },
  noteButtonLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  button: {
    minHeight: 44,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    marginTop: spacing[4],
  },
  buttonLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
});
