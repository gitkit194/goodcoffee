import { t, useLanguage } from '../../i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { BeanCard } from '../../components/BeanCard';
import { CupRow } from '../../components/CupRow';
import { Brand, Card, Chip, Eyebrow, Pill, PrimaryButton, Screen, SectionTitle, Stars, T, Title } from '../../components/ui';
import { useStore } from '../../data/store';
import { aromaName } from '../../lib/coffee';
import { dayLabel, monthName, recipeLine, time } from '../../lib/format';
import { colors, fonts } from '../../theme';

type Filter = 'alle' | 'favoriten' | 'bohnen';

export default function Tagebuch() {
  useLanguage();
  const { cups, myBeans, coffee, beans } = useStore();
  const [filter, setFilter] = useState<Filter>('alle');
  const [limit, setLimit] = useState(30);
  const now = new Date();
  const thisMonth = cups.filter((c) => {
    const d = new Date(c.brewed_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const favourites = myBeans.filter((b) => (b.bean.rating ?? 0) >= 4);
  const eyebrow =
    filter === 'alle'
      ? monthName() + ' · ' + t("cupCount", { count: thisMonth })
      : t("coffeeCount", { count: myBeans.length }) + " · " + t("cupCount", { count: cups.length });

  const latest = cups[0];
  const latestCoffee = coffee(latest?.coffee_id);

  return (
    <Screen>
      <Brand />
      <View style={{ gap: 10 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Title>{t("Journal")}</Title>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill label={t("All")} active={filter === 'alle'} onPress={() => setFilter('alle')} />
        <Pill label={t("Favourites")} active={filter === 'favoriten'} onPress={() => setFilter('favoriten')} />
        <Pill label={t("Coffees")} active={filter === 'bohnen'} onPress={() => setFilter('bohnen')} />
      </View>

      {filter === 'alle' ? (
        latest ? (
          <>
            <Card onPress={() => router.push({ pathname: '/tasse/[id]', params: { id: latest.id } })} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Eyebrow>{dayLabel(latest.brewed_at) + ' · ' + time(latest.brewed_at)}</Eyebrow>
                {dayLabel(latest.brewed_at) === t("Today") ? (
                  <View style={{ backgroundColor: colors.successBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <T style={{ fontSize: 11, color: colors.success, fontFamily: fonts.uiMedium }}>{t("New")}</T>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <BeanPhoto coffee={latestCoffee} size={64} />
                <T style={{ flex: 1, fontFamily: fonts.serifSemi, fontSize: 27, lineHeight: 30 }} numberOfLines={2}>
                  {latestCoffee?.name ?? t("Coffee")}
                </T>
                <Stars value={beans[latest.coffee_id]?.rating} />
              </View>
              <T style={{ fontSize: 13, color: colors.muted }}>{recipeLine(latest)}</T>
              {latest.aromas.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {latest.aromas.map((a) => (
                    <Chip key={a} label={aromaName(a)} />
                  ))}
                </View>
              ) : null}
            </Card>
            {cups.length > 1 ? (
              <View>
                <SectionTitle>{t("Your recent cups")}</SectionTitle>
                {cups.slice(1, limit).map((c, i, arr) => (
                  <CupRow key={c.id} cup={c} last={i === arr.length - 1} />
                ))}
                {cups.length > limit ? (
                  <View style={{ paddingTop: 12 }}>
                    <Pill label={t("Show older cups")} onPress={() => setLimit((l) => l + 30)} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <Empty text={t("No cups yet. Log your first cup to see it here.")} action />
        )
      ) : null}

      {filter === 'favoriten' ? (
        favourites.length ? favourites.map((row) => <BeanCard key={row.coffee.id} row={row} />) : <Empty text={t("Rate a coffee 4 or 5 stars to see it here.")} />
      ) : null}

      {filter === 'bohnen' ? (
        myBeans.length ? myBeans.map((row) => <BeanCard key={row.coffee.id} row={row} />) : <Empty text={t("No coffees yet. Choose one from the catalogue or add a new one when logging a cup.")} action />
      ) : null}
    </Screen>
  );
}

function Empty({ text, action }: { text: string; action?: boolean }) {
  useLanguage();
  return (
    <Card style={{ gap: 14 }}>
      <T style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>{text}</T>
      {action ? <PrimaryButton label={t("Log a cup")} onPress={() => router.push('/log/rezept')} /> : null}
    </Card>
  );
}
