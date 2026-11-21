import { t, useLanguage } from '../i18n';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { BeanPhoto } from './BeanPhoto';
import { useStore } from '../data/store';
import type { Cup } from '../data/types';
import { extractionLabel } from '../lib/coffee';
import { dayLabel, recipeLine, time } from '../lib/format';
import { colors, fonts } from '../theme';
import { Eyebrow, Stars, T } from './ui';

export function CupRow({ cup, last }: { cup: Cup; last?: boolean }) {
  useLanguage();
  const { coffee, beans } = useStore();
  const c = coffee(cup.coffee_id);
  const day = dayLabel(cup.brewed_at);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/tasse/[id]', params: { id: cup.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        { flexDirection: 'row', gap: 12, paddingVertical: 14, alignItems: 'center' },
        !last && { borderBottomWidth: 1, borderBottomColor: colors.line },
        pressed && { opacity: 0.7 },
      ]}
    >
      <BeanPhoto coffee={c} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Eyebrow>{day === t("Today") ? t("Today") + " · " + time(cup.brewed_at) : day}</Eyebrow>
        <T style={{ fontFamily: fonts.uiMedium, fontSize: 14 }} numberOfLines={1}>
          {c?.name ?? t("Unknown coffee")}
        </T>
        <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
          {recipeLine(cup) + ' · ' + extractionLabel(cup.extraction).toLowerCase()}
        </T>
      </View>
      <Stars value={beans[cup.coffee_id]?.rating} />
    </Pressable>
  );
}
