import { processLabel } from '../i18n/coffeeLabels';
import { t, useLanguage } from '../i18n';
import { router } from 'expo-router';
import { View } from 'react-native';

import { BeanPhoto } from './BeanPhoto';
import { useStore, type BeanRow } from '../data/store';
import { roastDate, short } from '../lib/format';
import { colors, fonts } from '../theme';
import { Card, Eyebrow, T } from './ui';

export function beanSubtitle(roaster: string, process: string | null | undefined, roast: string | null | undefined): string {
  const r = roastDate(roast);
  return [roaster, processLabel(process), r ? t("Roasted {date}", { date: r }) : null].filter(Boolean).join(' · ');
}

export function BeanCard({ row }: { row: BeanRow }) {
  useLanguage();
  const { roasterName } = useStore();
  const { coffee, bean, cups, lastCup } = row;
  const stats = [
    { label: t("Rating"), value: bean.rating ? '★ ' + bean.rating : '–' },
    { label: t("Cups"), value: String(cups) },
    { label: t("Last recipe"), value: lastCup ? t("Grind") + " " + short(lastCup.grind) + ' · ' + short(lastCup.dose_g) + ' → ' + short(lastCup.yield_g) + ' g · ' + lastCup.time_s + ' s' : '–' },
  ];
  return (
    <Card onPress={() => router.push({ pathname: '/bohne/[id]', params: { id: coffee.id } })} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <BeanPhoto coffee={coffee} size={64} />
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: fonts.serifSemi, fontSize: 24, lineHeight: 27 }} numberOfLines={2}>
            {coffee.name}
          </T>
          <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
            {beanSubtitle(roasterName(coffee.roaster_id), coffee.process, bean.roast_date)}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {stats.map((s, i) => (
          <View key={s.label} style={{ flex: i === 2 ? 2.2 : i === 0 ? 1.3 : 1, gap: 4 }}>
            <Eyebrow>{s.label}</Eyebrow>
            <T style={{ fontSize: i === 2 ? 12 : 15, fontFamily: i === 2 ? fonts.ui : fonts.uiMedium }} numberOfLines={1}>
              {s.value}
            </T>
          </View>
        ))}
      </View>
    </Card>
  );
}
