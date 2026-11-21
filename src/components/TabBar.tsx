import { t, useLanguage } from '../i18n';
// Bottom bar from the design: four tabs and a raised + in the middle that starts a new cup.
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../theme';
import { BookIcon, HomeIcon, PersonIcon, PlusIcon, SearchIcon } from './icons';
import { T } from './ui';


export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  useLanguage();
  const TABS: Record<string, { label: string; icon: (c: string) => ReactNode }> = {
    index: { label: t("Home"), icon: (c) => <HomeIcon color={c} /> },
    entdecken: { label: t("Discover"), icon: (c) => <SearchIcon color={c} /> },
    tagebuch: { label: t("Journal"), icon: (c) => <BookIcon color={c} /> },
    profil: { label: t("Profile"), icon: (c) => <PersonIcon color={c} /> },
  };

  const insets = useSafeAreaInsets();
  const item = (name: string) => {
    const index = state.routes.findIndex((r) => r.name === name);
    if (index < 0) return null;
    const route = state.routes[index];
    const focused = state.index === index;
    const color = focused ? colors.text : colors.muted;
    return (
      <Pressable
        key={name}
        style={styles.item}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={TABS[name].label}
        onPress={() => {
          if (!focused) navigateToTab(route.key);
        }}
      >
        {TABS[name].icon(color)}
        <T style={[styles.label, { color, fontFamily: focused ? fonts.uiMedium : fonts.ui }]}>{TABS[name].label}</T>
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {item('index')}
      {item('entdecken')}
      <View style={styles.item}>
        <Pressable
          onPress={() => router.push('/log/rezept')}
          accessibilityRole="button"
          accessibilityLabel={t("Log a new cup")}
          style={({ pressed }) => [styles.plus, pressed && { opacity: 0.85 }]}
        >
          <PlusIcon />
        </Pressable>
      </View>
      {item('tagebuch')}
      {item('profil')}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48 },
  label: { fontSize: 10 },
  plus: { width: 52, height: 44, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
