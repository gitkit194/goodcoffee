import { processLabel } from '../../i18n/coffeeLabels';
import { t, useLanguage } from '../../i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Brand, Card, Chip, Eyebrow, LevelBar, NavHeader, PrimaryButton, Screen, Stars, T, TextButton, Title } from '../../components/ui';
import { useStore } from '../../data/store';
import { aromaName, extractionHint, extractionLabel } from '../../lib/coffee';
import { confirm } from '../../lib/confirm';
import { draftFromCup } from '../../lib/draft';
import { dayLabel, num, ratio, short, time } from '../../lib/format';
import { colors, fonts } from '../../theme';

function level(v: number, low: string, high: string) {
  if (v <= 3) return low;
  if (v >= 7) return high;
  return t("Medium");
}

export default function Tasse() {
  useLanguage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { cup, coffee, roasterName, beans, deleteCup, setDraft } = useStore();
  const c = cup(id);
  if (!c) {
    return (
      <Screen>
        <Brand />
        <NavHeader left={{ label: t("← Back"), onPress: () => router.back() }} title={t("Cup")} />
        <T style={{ color: colors.muted }}>{t("This cup is no longer available.")}</T>
      </Screen>
    );
  }
  const bean = coffee(c.coffee_id);
  const mine = beans[c.coffee_id];
  const sub = [roasterName(bean?.roaster_id), processLabel(bean?.process)].filter(Boolean).join(' · ');
  const taste = c.sweetness !== null && c.acidity !== null && c.body !== null;

  const reuse = () => {
    setDraft({ coffeeId: c.coffee_id, grind: c.grind, dose_g: c.dose_g, yield_g: c.yield_g, time_s: c.time_s, extraction: 5 });
    router.push('/log/rezept');
  };

  const edit = () => {
    setDraft(draftFromCup(c));
    router.push({ pathname: '/log/rezept', params: { edit: c.id } });
  };

  const remove = async () => {
    if (await confirm(t("Delete cup?"), t("This removes the cup from your journal. Your coffee rating will stay."), t("Delete"))) {
      deleteCup(c.id);
      router.back();
    }
  };

  return (
    <Screen
      footer={
        <>
          <PrimaryButton label={t("Reuse recipe")} onPress={reuse} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label={t("Delete cup")} onPress={remove} style={{ color: colors.muted, fontFamily: fonts.ui }} />
          </View>
        </>
      }
    >
      <Brand />
      <NavHeader left={{ label: t("← Back"), onPress: () => router.back() }} title={t("Cup")} right={{ label: t("Edit"), onPress: edit }} />
      <View style={{ gap: 8 }}>
        <Eyebrow>{dayLabel(c.brewed_at) + ' · ' + time(c.brewed_at)}</Eyebrow>
        <Title size={34}>{bean?.name ?? t("Coffee")}</Title>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T style={{ fontSize: 13, color: colors.muted }}>{sub}</T>
          <Stars value={mine?.rating} size={15} />
        </View>
      </View>

      <Card style={{ gap: 12 }}>
        <Eyebrow>{t("Recipe")}</Eyebrow>
        <View style={{ flexDirection: 'row' }}>
          {[
            [t("Grind"), short(c.grind)],
            [t("Dose"), num(c.dose_g) + ' g'],
            [t("Yield"), num(c.yield_g) + ' g'],
            [t("Time"), c.time_s + ' s'],
          ].map(([l, v]) => (
            <View key={l} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Eyebrow>{l}</Eyebrow>
              <T style={{ fontFamily: fonts.serif, fontSize: 26, fontVariant: ['lining-nums'] }}>{v}</T>
            </View>
          ))}
        </View>
        <T style={{ textAlign: 'center', fontSize: 12, color: colors.muted }}>{t("Ratio {ratio}", { ratio: ratio(c.dose_g, c.yield_g) })}</T>
        <View style={{ height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden' }}>
          <View style={{ flex: 3.5, backgroundColor: colors.field }} />
          <View style={{ flex: 3, backgroundColor: colors.kraft }} />
          <View style={{ flex: 3.5, backgroundColor: colors.field }} />
          <View style={{ position: 'absolute', left: `${c.extraction * 10}%`, marginLeft: -7, top: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.text }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontSize: 12, fontFamily: fonts.uiMedium }}>{extractionLabel(c.extraction)}</T>
          <T style={{ fontSize: 12, color: colors.muted }}>{extractionHint(c.extraction)}</T>
        </View>
      </Card>

      {taste ? (
        <Card style={{ gap: 12 }}>
          <Eyebrow>{t("Taste")}</Eyebrow>
          {[
            [t("Sweetness"), c.sweetness!, level(c.sweetness!, t("low"), t("high"))],
            [t("Acidity"), c.acidity!, level(c.acidity!, t("low"), t("high"))],
            [t("Body"), c.body!, level(c.body!, t("light, tea-like"), t("heavy, creamy"))],
          ].map(([l, v, d]) => (
            <View key={l as string} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T style={{ fontSize: 13 }}>{l}</T>
                <T style={{ fontSize: 12, color: colors.muted }}>{d}</T>
              </View>
              <LevelBar value={v as number} />
            </View>
          ))}
          {c.aromas.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.aromas.map((a) => (
                <Chip key={a} label={aromaName(a)} />
              ))}
            </View>
          ) : null}
        </Card>
      ) : (
        <T style={{ fontSize: 13, color: colors.muted }}>{t("Recipe saved without tasting notes.")}</T>
      )}

      {mine?.comment ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>{t("Coffee notes")}</Eyebrow>
          <View style={{ borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 12 }}>
            <T style={{ fontFamily: fonts.serif, fontSize: 19, lineHeight: 25 }}>{mine.comment}</T>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
