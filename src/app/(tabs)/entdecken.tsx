import { originLabel, processLabel } from '../../i18n/coffeeLabels';
import { t, useLanguage } from '../../i18n';
import { flavourNotes, noteLabel } from '../../i18n/notes';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { SearchIcon } from '../../components/icons';
import { Brand, Eyebrow, Pill, Screen, T, Title } from '../../components/ui';
import { searchCoffees } from '../../data/catalog';
import { useStore } from '../../data/store';
import type { Coffee } from '../../data/types';
import { colors, fonts } from '../../theme';

export default function Entdecken() {
  const { language } = useLanguage();
  const { allCoffees, roasters, roasterName, beans } = useStore();
  const [query, setQuery] = useState('');
  const [roasterId, setRoasterId] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);

  const catalog = useMemo(() => allCoffees.filter((c) => roasters.some((r) => r.id === c.roaster_id)), [allCoffees, roasters]);
  const withBeans = useMemo(
    () =>
      roasters
        .map((r) => ({ r, n: catalog.filter((c) => c.roaster_id === r.id).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n),
    [roasters, catalog],
  );
  const list = useMemo(() => {
    if (query.trim()) return searchCoffees(catalog, roasterName, query, 60);
    const base = roasterId ? catalog.filter((c) => c.roaster_id === roasterId) : catalog;
    return [...base].sort((a, b) => roasterName(a.roaster_id).localeCompare(roasterName(b.roaster_id)) || a.name.localeCompare(b.name));
  }, [catalog, query, roasterId, roasterName]);

  const row = (c: Coffee) => (
    <Pressable
      key={c.id}
      onPress={() => router.push({ pathname: '/bohne/[id]', params: { id: c.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { opacity: 0.7 }]}
    >
      <BeanPhoto coffee={c} size={64} stockOnly />
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontFamily: fonts.uiMedium }} numberOfLines={1}>
          {c.name}
        </T>
        <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
          {[roasterName(c.roaster_id), originLabel(c.origin_country), processLabel(c.process)].filter(Boolean).join(' · ')}
        </T>
        {flavourNotes(c.roaster_notes).length ? (
          <T style={{ fontSize: 12, color: colors.text }} numberOfLines={1}>
            {flavourNotes(c.roaster_notes).slice(0, 3).map((n) => noteLabel(n, language)).join(' · ')}
          </T>
        ) : null}
      </View>
      {beans[c.id] ? <Eyebrow style={{ color: colors.accent }}>{t("Yours")}</Eyebrow> : null}
    </Pressable>
  );

  return (
    <Screen>
      <Brand />
      <View style={{ gap: 10 }}>
        <Eyebrow>{t("Berlin · {roasters} roasters · {coffees} coffees", { roasters: withBeans.length, coffees: catalog.length })}</Eyebrow>
        <Title>{t("Discover")}</Title>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14 }}>
        <SearchIcon size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("Coffee, roaster or country")}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.text, height: 46 }}
        />
      </View>
      {!query.trim() ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -24 }}>
          <View style={{ width: 16 }} />
          <Pill label={t("All")} active={!roasterId} onPress={() => setRoasterId(null)} />
          {withBeans.map(({ r }) => (
            <Pill key={r.id} label={r.name} active={roasterId === r.id} onPress={() => setRoasterId(r.id)} />
          ))}
          <View style={{ width: 16 }} />
        </ScrollView>
      ) : null}
      <View>
        {list.slice(0, limit).map(row)}
        {list.length === 0 ? <T style={{ color: colors.muted, paddingVertical: 12 }}>{t("No results found.")}</T> : null}
        {list.length > limit ? (
          <View style={{ paddingTop: 12 }}>
            <Pill label={t("Show {count} more", { count: list.length - limit })} onPress={() => setLimit((l) => l + 40)} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
