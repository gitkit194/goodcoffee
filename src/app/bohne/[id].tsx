import { catalogText, originLabel, processLabel } from '../../i18n/coffeeLabels';
import { flavourNotes, noteLabel } from '../../i18n/notes';
import { t, useLanguage } from '../../i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, TextInput, View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { CommunityBadge } from '../../components/CommunityBadge';
import { CupRow } from '../../components/CupRow';
import { Brand, Card, Chip, Eyebrow, NavHeader, PrimaryButton, Screen, StarPicker, T, TextButton, Title } from '../../components/ui';
import { useRatingStats } from '../../data/ratings';
import { useStore } from '../../data/store';
import { dateInput, num, parseDate, roastDateMessage, short } from '../../lib/format';
import { roastLevelOf } from '../../lib/validate';
import type { Coffee } from '../../data/types';
import { combineRating } from '../../lib/rating';
import { draftFor } from '../../lib/draft';
import { safeHttpsUrl } from '../../lib/url';
import { colors, fonts } from '../../theme';



/** Always a level: the one given, else the estimate, marked as such. */
function roastLevelText(c: Coffee, labels: Record<string, string>): string {
  const { level, estimated } = roastLevelOf(c);
  return estimated ? t("{level} (estimated)", { level: labels[level] }) : labels[level];
}

/** "18 g → 40 g · 28 s · 93.5 °C", or null when the roaster gives no espresso recipe. */
function recipeText(c: Coffee): string | null {
  if (!c.recipe_dose_g || !c.recipe_yield_g) return null;
  return [
    short(c.recipe_dose_g) + ' g → ' + short(c.recipe_yield_g) + ' g',
    c.recipe_time_s ? c.recipe_time_s + ' s' : null,
    c.recipe_temp_c ? num(c.recipe_temp_c) + ' °C' : null,
  ].filter(Boolean).join(' · ');
}

export default function Bohne() {
  const { language } = useLanguage();
  const ROAST_FOR: Record<string, string> = { espresso: t("Espresso"), filter: t("Filter"), omni: t("Espresso and filter") };
  const ROAST_LEVEL: Record<string, string> = { hell: t("Light"), mittel: t("Medium"), dunkel: t("Dark") };

  const { id } = useLocalSearchParams<{ id: string }>();
  const { coffee, roaster, beans, cupsFor, addBean, updateBean, setDraft, cups, morePhotosFor } = useStore();
  const c = coffee(id);
  // The route may still carry the id the bean had before it was replaced by the shared one.
  const mine = beans[c?.id ?? id];
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [date, setDate] = useState(dateInput(mine?.roast_date));
  const community = combineRating(useRatingStats(id), mine?.rating);

  if (!c) {
    return (
      <Screen>
        <Brand />
        <NavHeader left={{ label: t("← Back"), onPress: () => router.back() }} title={t("Coffee")} />
        <T style={{ color: colors.muted }}>{t("This coffee is no longer available.")}</T>
      </Screen>
    );
  }
  const r = roaster(c.roaster_id);
  const beanCups = cupsFor(c.id);
  const facts = [
    [t("Roaster"), r?.name],
    [t("Origin"), originLabel(c.origin_country)],
    [t("Region"), catalogText(c.region)],
    [t("Producer"), catalogText(c.producer)],
    [t("Processing"), processLabel(c.process)],
    [t("Variety"), catalogText(c.variety)],
    [t("Roast profile"), c.roast_for ? ROAST_FOR[c.roast_for] : null],
    [t("Roast level"), roastLevelText(c, ROAST_LEVEL)],
    [t("Roaster's recipe"), recipeText(c)],
  ].filter((f): f is [string, string] => !!f[1]);

  const brew = () => {
    // Added to "my coffees" when the first cup is saved, not when the recipe is merely opened.
    setDraft(draftFor(c.id, cups, c));
    router.push('/log/rezept');
  };

  const saveComment = () => {
    const t = comment.trim();
    if (t !== (mine?.comment ?? '')) updateBean(c.id, { comment: t || null });
  };

  const saveDate = () => {
    const iso = date.trim() ? parseDate(date) : null;
    if (roastDateMessage(date)) return;
    if (iso !== (mine?.roast_date ?? null)) updateBean(c.id, { roast_date: iso });
  };

  return (
    <Screen
      footer={
        <>
          <PrimaryButton label={t("Brew this coffee")} onPress={brew} />
          {!mine ? (
            <View style={{ alignItems: 'center' }}>
              <TextButton label={t("Add to my coffees")} onPress={() => addBean(c.id)} />
            </View>
          ) : null}
        </>
      }
    >
      <Brand />
      <NavHeader left={{ label: t("← Back"), onPress: () => router.back() }} title={t("Coffee")} />
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <BeanPhoto coffee={c} size={112} />
        <View style={{ flex: 1 }}>
          <Title size={32}>{c.name}</Title>
          {/* Own photos of beans that were merged into this one. */}
          {morePhotosFor(c.id).length ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {morePhotosFor(c.id).map((uri) => (
                <Image key={uri} source={{ uri }} accessibilityLabel={t("Coffee bag")} style={{ width: 40, height: 40, borderRadius: 8 }} />
              ))}
            </View>
          ) : null}
          {community ? (
            <T
              accessibilityLabel={t("Average rating from all users") + ': ' + (community.count ? t("ratingSummary", { average: num(community.average, 1), count: community.count }) : t("No ratings yet"))}
              style={{ fontSize: 13, color: community.count ? colors.accent : colors.muted, marginTop: 4 }}
            >
              {community.count ? '★ ' + t("ratingSummary", { average: num(community.average, 1), count: community.count }) : t("No ratings yet")}
            </T>
          ) : null}
        </View>
      </View>
      <CommunityBadge coffee={c} explain />

      {facts.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {facts.map(([l, v], i) => (
            <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10, borderBottomWidth: i < facts.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              <T style={{ fontSize: 13, color: colors.muted }}>{l}</T>
              <T style={{ fontSize: 13, flex: 1, textAlign: 'right' }}>{v}</T>
            </View>
          ))}
        </Card>
      ) : null}

      {flavourNotes(c.roaster_notes).length ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>{t("According to {roaster}", { roaster: r?.name ?? t("Roaster") })}</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {flavourNotes(c.roaster_notes).map((n) => (
              <Chip key={n} label={noteLabel(n, language)} />
            ))}
          </View>
        </View>
      ) : null}

      {safeHttpsUrl(c.product_url) ? <TextButton label={t("View in the roaster’s shop")} onPress={() => Linking.openURL(safeHttpsUrl(c.product_url)!)} /> : null}

      {mine ? (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ fontFamily: fonts.uiMedium }}>{t("Your coffee rating")}</T>
              <T style={{ fontSize: 12, color: colors.accent }}>{mine.rating ? mine.rating + ' / 5' : '– / 5'}</T>
            </View>
            <StarPicker value={mine.rating ?? 0} onChange={(n) => updateBean(c.id, { rating: n })} />
          </View>
          <View style={{ gap: 8 }}>
            <T style={{ fontFamily: fonts.uiMedium }}>{t("Coffee notes")}</T>
            <TextInput
              value={comment}
              onChangeText={setComment}
              onBlur={saveComment}
              placeholder={t("How does this coffee taste?")}
              // A note is short: the return key closes the keyboard instead of adding a line.
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              placeholderTextColor={colors.muted}
              multiline
              style={{ minHeight: 80, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, padding: 14, fontFamily: fonts.ui, fontSize: 14, color: colors.text, textAlignVertical: 'top' }}
            />
          </View>
          <View style={{ gap: 8 }}>
            <T style={{ fontFamily: fonts.uiMedium }}>{t("Your bag’s roast date")}</T>
            <TextInput
              value={date}
              onChangeText={setDate}
              onBlur={saveDate}
              placeholder={t("DD/MM/YYYY")}
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
              style={{ height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14, fontFamily: fonts.ui, fontSize: 14, color: colors.text }}
            />
            {roastDateMessage(date) ? <T style={{ fontSize: 12, color: colors.accent }}>{roastDateMessage(date)}</T> : null}
          </View>
        </View>
      ) : null}

      {beanCups.length ? (
        <View>
          <Eyebrow>{t("cupsWithCoffee", { count: beanCups.length })}</Eyebrow>
          {beanCups.slice(0, 20).map((cup, i, arr) => (
            <CupRow key={cup.id} cup={cup} last={i === arr.length - 1} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
