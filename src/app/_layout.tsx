import { CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { PrimaryButton, Screen, T, TextButton, Title } from '../components/ui';
import { DataProvider, useStore } from '../data/store';
import { t, useLanguage } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { colors, fonts } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Shown instead of the app when the stored journal could not be read. The app never starts empty over it. */
function JournalUnreadable() {
  useLanguage();
  const { loadProblem, openJournal, startNewJournal } = useStore();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <Screen footer={<PrimaryButton label={t("Try again")} disabled={busy} onPress={() => run(openJournal)} />}>
      <Title size={30}>{t("Your journal could not be read")}</Title>
      <T style={{ fontSize: 15, lineHeight: 22 }}>
        {loadProblem?.kind === 'corrupt'
          ? t("The stored journal is damaged and cannot be opened. Nothing was changed or deleted.")
          : t("The phone's storage did not answer. Nothing was changed or deleted. Try again in a moment, or restart the app.")}
      </T>
      {loadProblem?.kind === 'corrupt' ? (
        <TextButton label={t("Start a new journal (keep a backup of the old one)")} underline onPress={() => run(startNewJournal)} />
      ) : null}
    </Screen>
  );
}

/** A write to the phone failed: say so until a write succeeds, and offer to try again. */
function SaveFailedBanner() {
  useLanguage();
  const { saveFailed, retrySave } = useStore();
  if (!saveFailed) return null;
  return (
    <Pressable
      onPress={() => retrySave().catch(() => undefined)}
      accessibilityRole="button"
      style={{ position: 'absolute', left: 12, right: 12, bottom: 96, backgroundColor: colors.text, borderRadius: 12, padding: 14 }}
    >
      <View style={{ gap: 4 }}>
        <T accessibilityRole="alert" style={{ color: colors.bg, fontSize: 13 }}>
          {t("Your latest changes could not be saved on this device yet.")}
        </T>
        <T style={{ color: colors.bg, fontSize: 13, fontFamily: fonts.uiSemi }}>{t("Try again")}</T>
      </View>
    </Pressable>
  );
}

function AppStack() {
  const { ready, loadProblem } = useStore();
  useEffect(() => {
    if (ready || loadProblem) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, loadProblem]);
  if (loadProblem) return <JournalUnreadable />;
  if (!ready) return null;
  return (
    <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="log/rezept" />
      <Stack.Screen name="log/geschmack" />
      <Stack.Screen name="bohne/waehlen" />
      <Stack.Screen name="bohne/neu" />
      <Stack.Screen name="bohne/[id]" />
      <Stack.Screen name="tasse/[id]" />
      <Stack.Screen name="settings/language" />
    </Stack>
    <SaveFailedBanner />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  if (!loaded && !error) return null;
  return (
    <LanguageProvider>
      <DataProvider>
        <StatusBar style="dark" />
        <AppStack />
      </DataProvider>
    </LanguageProvider>
  );
}
