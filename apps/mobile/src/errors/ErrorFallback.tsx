import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { BASE_LOCALE, BUNDLED_MESSAGES, createTranslator, radii, resolveTheme, spacing, typography } from '@platform/shared';
import type { Translate } from '@platform/shared';

import { resolveOfflineTranslate } from '../i18n/offlineTranslate';
import { reportError } from './runtime';

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

  useEffect(() => {
    setCode(reportError(error, { severity: 'fatal' }));
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
