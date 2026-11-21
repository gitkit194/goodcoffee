import { originLabel, processLabel } from '../../i18n/coffeeLabels';
import { t, useLanguage } from '../../i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { beanSubtitle } from '../../components/BeanCard';
import { CheckIcon, SearchIcon } from '../../components/icons';
import { Brand, DashedButton, Eyebrow, NavHeader, PrimaryButton, Screen, T, Title } from '../../components/ui';
import { searchCoffees } from '../../data/catalog';
import { isCommunity } from '../../lib/community';
import { useStore } from '../../data/store';
import type { Coffee } from '../../data/types';
import { switchBean } from '../../lib/draft';
import { colors, fonts } from '../../theme';

export default function BohneWaehlen() {
  useLanguage();
  const { from, selected } = useLocalSearchParams<{ from?: string; selected?: string }>();
  const { myBeans, allCoffees, roasterName, draft, setDraft, cups, beans } = useStore();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(selected ?? draft?.coffeeId ?? myBeans[0]?.coffee.id ?? null);

  const mine = useMemo(() => {
    if (!query.trim()) return myBeans.map((b) => b.coffee);
    const ids = new Set(searchCoffees(myBeans.map((b) => b.coffee), roasterName, query, 50).map((c) => c.id));
    return myBeans.map((b) => b.coffee).filter((c) => ids.has(c.id));
  }, [myBeans, query, roasterName]);

  const catalogHits = useMemo(() => {
    if (!query.trim()) return [];
    return searchCoffees(allCoffees, roasterName, query).filter((c) => !beans[c.id]);
  }, [allCoffees, roasterName, query, beans]);

  const pickedCoffee = allCoffees.find((c) => c.id === picked);

  const confirm = () => {
    if (!picked) return;
    // The bean goes on "my coffees" only with its first saved cup (saveCup), so just looking around
    // and cancelling leaves the journal as it was.
    setDraft(switchBean(draft, picked, cups, pickedCoffee));
    router.dismissTo('/log/rezept');
  };

  const row = (c: Coffee, sub: string) => {
    const on = picked === c.id;
    return (
      <Pressable
        key={c.id}
        onPress={() => setPicked(c.id)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          borderRadius: 12,
          borderWidth: on ? 1.5 : 1,
          borderColor: on ? colors.accent : colors.line,
          backgroundColor: colors.card,
        }}
      >
        <BeanPhoto coffee={c} size={56} />
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: fonts.uiMedium }} numberOfLines={1}>
            {c.name}
          </T>
          <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
            {sub}
          </T>
        </View>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: on ? colors.accent : colors.kraft,
            backgroundColor: on ? colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {on ? <CheckIcon size={12} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen
      footer={
        <PrimaryButton
          label={pickedCoffee ? t("Continue with {name}", { name: pickedCoffee.name }) : t("Choose a coffee")}
          disabled={!pickedCoffee}
          onPress={confirm}
        />
      }
    >
      <Brand />
      <NavHeader left={{ label: from === 'rezept' ? t("← Recipe") : t("← Back"), onPress: () => router.back() }} title={t("Coffee")} />
      <View style={{ gap: 10 }}>
        <Eyebrow>{t("What’s in your grinder?")}</Eyebrow>
        <Title>{t("Which coffee?")}</Title>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14 }}>
        <SearchIcon size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("Search for a coffee or roaster")}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.text, height: 46 }}
        />
      </View>

      {mine.length ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>{t("Your coffees")}</Eyebrow>
          {mine.map((c) => row(c, beanSubtitle(roasterName(c.roaster_id), c.process, beans[c.id]?.roast_date)))}
        </View>
      ) : !query.trim() ? (
        <T style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>
          {t("Find your coffee in the Berlin roaster catalogue or add a new one.")}</T>
      ) : null}

      {catalogHits.length ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>{t("From the catalogue")}</Eyebrow>
          {catalogHits.map((c) => row(c, [isCommunity(c) ? t("From the community") : null, roasterName(c.roaster_id), originLabel(c.origin_country), processLabel(c.process)].filter(Boolean).join(' · ')))}
        </View>
      ) : query.trim() && !mine.length ? (
        <T style={{ fontSize: 13, color: colors.muted }}>{t("No results. Add the coffee yourself.")}</T>
      ) : null}

      <DashedButton label={t("Scan a bag")} onPress={() => router.push({ pathname: '/bohne/neu', params: { scan: '1', from: from ?? '' } })} />
      <DashedButton
        label={query.trim() ? t("Add “{name}”", { name: query.trim() }) : t("Add a new coffee")}
        onPress={() => router.push({ pathname: '/bohne/neu', params: { name: query.trim(), from: from ?? '' } })}
      />
    </Screen>
  );
}
