import { t } from '../i18n';
import { Alert, Platform } from 'react-native';

/** Yes/no question; uses the browser dialog on web where Alert buttons don't exist. */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(title + '\n\n' + message));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: t("Cancel"), style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
