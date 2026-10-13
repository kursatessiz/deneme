import { Alert } from 'react-native';
import type { Translate } from '@platform/shared';

/**
 * Informational alert with an explicit, translated dismiss button. Alert.alert
 * without buttons shows the OS-default "OK" in the device language instead of
 * the language the user picked in the app (docs/I18N.md).
 */
export function showNotice(t: Translate, title: string, message?: string): void {
  Alert.alert(title, message, [{ text: t('common.ok') }]);
}

/**
 * Two-button confirmation with explicit, translated labels (same reason as showNotice).
 * `destructive` renders the confirm button in the platform's destructive style.
 */
export function confirmAction(options: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}): void {
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel, style: 'cancel' },
    { text: options.confirmLabel, style: options.destructive ? 'destructive' : 'default', onPress: options.onConfirm },
  ]);
}
