import { t, useLanguage } from '../../i18n';
import { router } from 'expo-router';
import { View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { CupRow } from '../../components/CupRow';
import { Brand, Card, Eyebrow, PrimaryButton, Screen, SectionTitle, T, TextButton, Title } from '../../components/ui';
import { useStore } from '../../data/store';
import { daysAgo, greeting, longDate, recipeLine } from '../../lib/format';
import { colors, fonts } from '../../theme';

export default function Home() {
  useLanguage();
  const { cups, profile, coffee, roasterName } = useStore();
  const last = cups[0];
  const lastCoffee = coffee(last?.coffee_id);
  const today = cups.filter((c) => daysAgo(c.brewed_at) === 0).length;
  const hello = greeting() + (profile.name ? ',' : '.');

  return (
    <Screen>
      <Brand />
      <View style={{ gap: 10 }}>
        <Eyebrow>{longDate()}</Eyebrow>
        <Title>{profile.name ? hello + '\n' + profile.name + '.' : hello}</Title>
      </View>

      {last && lastCoffee ? (
        <Card style={{ gap: 12, padding: 18 }}>
          <Eyebrow>{today === 0 ? t("No cups today yet") : t("cupsToday", { count: today })}</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <BeanPhoto coffee={lastCoffee} size={64} />
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: fonts.serifSemi, fontSize: 27, lineHeight: 30 }} numberOfLines={2}>
                {lastCoffee.name}
              </T>
              {lastCoffee.roaster_id ? <T style={{ fontSize: 12, color: colors.muted }}>{roasterName(lastCoffee.roaster_id)}</T> : null}
            </View>
          </View>
          <T style={{ fontSize: 13, color: colors.muted }}>{t("Last: {recipe}", { recipe: recipeLine(last) })}</T>
          <PrimaryButton label={t("Log a cup")} onPress={() => router.push('/log/rezept')} />
        </Card>
      ) : (
        <Card style={{ gap: 12, padding: 18 }}>
          <Eyebrow>{t("Welcome")}</Eyebrow>
          <T style={{ fontFamily: fonts.serifSemi, fontSize: 27, lineHeight: 30 }}>{t("Your first cup")}</T>
          <T style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>
            {t("Choose your coffee, set your grind and record how it tastes. Next time, start with this recipe.")}</T>
          <PrimaryButton label={t("Log your first cup")} onPress={() => router.push('/log/rezept')} />
        </Card>
      )}

      {cups.length > 0 ? (
        <View>
          <SectionTitle right={<TextButton label={t("View all")} onPress={() => router.navigate('/tagebuch')} />}>{t("Your recent cups")}</SectionTitle>
          {cups.slice(0, 3).map((c, i, arr) => (
            <CupRow key={c.id} cup={c} last={i === arr.length - 1} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
