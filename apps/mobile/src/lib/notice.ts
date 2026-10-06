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
