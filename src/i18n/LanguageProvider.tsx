import { getLocales } from 'expo-localization';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { getLanguage, initialiseLanguage, setDeviceLanguages, useLanguage } from './index';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const { language } = useLanguage();
  useEffect(() => {
    let mounted = true;
    const refresh = () => setDeviceLanguages(getLocales().map((locale) => locale.languageTag));
    refresh();
    initialiseLanguage().then(() => { if (mounted) setReady(true); });
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    if (Platform.OS === 'web') window.addEventListener('languagechange', refresh);
    return () => {
      mounted = false;
      subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('languagechange', refresh);
    };
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') document.documentElement.lang = getLanguage();
  }, [language]);
  return ready ? children : null;
}
