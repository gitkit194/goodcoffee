import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { CheckIcon } from '../../components/icons';
import { Brand, Card, NavHeader, Screen, T } from '../../components/ui';
import { t, useLanguage, type LanguagePreference } from '../../i18n';
import { colors, fonts } from '../../theme';

export default function LanguageSettings() {
  const { preference, setLanguagePreference } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const back = () => router.canGoBack() ? router.back() : router.replace('/profil');
  const choose = async (value: LanguagePreference) => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await setLanguagePreference(value);
      if (mounted.current) back();
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const options = [
    { value: 'system', label: t('Device language'), detail: t('Automatically follows your device language.') },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ] as const;

  return (
    <Screen>
      <Brand />
      <NavHeader left={{ label: t('← Back'), onPress: back }} title={t('Language')} />
      <Card style={{ paddingVertical: 0 }}>
        {options.map((option, index) => (
          <Pressable
            key={option.value}
            onPress={() => choose(option.value)}
            disabled={saving}
            accessibilityRole="radio"
            accessibilityState={{ checked: preference === option.value, disabled: saving }}
            accessibilityLabel={option.label}
            style={({ pressed }) => ({ minHeight: 60, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: index < options.length - 1 ? 1 : 0, borderBottomColor: colors.line, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <T style={{ fontFamily: preference === option.value ? fonts.uiMedium : fonts.ui }}>{option.label}</T>
              {'detail' in option ? <T style={{ fontSize: 12, lineHeight: 18, color: colors.muted }}>{option.detail}</T> : null}
            </View>
            <View style={{ width: 20 }}>
              {preference === option.value ? <CheckIcon color={colors.accent} size={20} /> : null}
            </View>
          </Pressable>
        ))}
      </Card>
      {error ? <T accessibilityRole="alert" style={{ color: colors.accent }}>{t('Could not save your language preference.')}</T> : null}
    </Screen>
  );
}
