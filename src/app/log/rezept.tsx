import { t, useLanguage } from '../../i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { BeanPhoto } from '../../components/BeanPhoto';
import { GrindDial } from '../../components/GrindDial';
import { Card, Eyebrow, NavHeader, PrimaryButton, Screen, Slider, Stepper, T, TextButton } from '../../components/ui';
import { useStore, type Draft } from '../../data/store';
import type { Cup } from '../../data/types';
import { extractionHint, extractionLabel } from '../../lib/coffee';
import { daysAgo, num, ratio, shortDay } from '../../lib/format';
import { roastLevelOf } from '../../lib/validate';
import { draftFor, draftToContinue, saveTarget, withNewCup } from '../../lib/draft';
import { colors, fonts } from '../../theme';

export default function Rezept() {
  useLanguage();
  const store = useStore();
  const { draft: stored, setDraft, cups, myBeans, coffee, roasterName, cupsFor, saveCup, updateCup, cup } = store;
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  // A left-over edit draft must never turn "Log a cup" into editing an old cup.
  const draft = draftToContinue(stored, edit);
  const [dragging, setDragging] = useState(false);
  // A write to the phone that failed: the entry stays in memory and on this screen until it is on disk.
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const { height } = useWindowDimensions();
  // iPhone SE and similar: about 650 pt of usable height.
  const compact = height < 700;

  useEffect(() => {
    if (draft) return;
    const coffeeId = cups[0]?.coffee_id ?? myBeans[0]?.coffee.id;
    if (coffeeId) setDraft(draftFor(coffeeId, cups, coffee(coffeeId)));
    else router.replace({ pathname: '/bohne/waehlen', params: { from: 'start' } });
    // Only on first open of the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!draft) return <Screen>{null}</Screen>;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const bean = coffee(draft.coffeeId);
  const prev = cupsFor(draft.coffeeId)[0];
  const ago = prev ? daysAgo(prev.brewed_at) : -1;
  const editing = draft.cupId ? cup(draft.cupId) : undefined;
  const eyebrow = editing ? t("Editing cup") : ago === 0 ? t("Same as today") : ago === 1 ? t("Same as yesterday") : ago > 1 ? t("Same as last time") : draft.start === 'roaster' ? t("Roaster's recipe") : draft.start === 'standard' ? t("Starting point") : t("Your coffee");
  // Where the values come from, in a few words after the ratio. Gone once dose, yield or time differ.
  const origin = editing ? null : draftFor(draft.coffeeId, cups.filter((c) => c.id !== draft.newCupId), bean);
  const lastOwn = cupsFor(draft.coffeeId).find((c) => c.id !== draft.newCupId);
  const untouched = !!origin && origin.dose_g === draft.dose_g && origin.yield_g === draft.yield_g && origin.time_s === draft.time_s;
  const startNote = !untouched
    ? null
    : lastOwn
      ? t("as on {date}", { date: shortDay(lastOwn.brewed_at) })
      : draft.start === 'roaster' && bean
        ? (() => {
            const from = bean.roaster_id ? roasterName(bean.roaster_id) : '';
            if (from && bean.recipe_temp_c) return t("from {roaster}, water {temp} °C", { roaster: from, temp: num(Number(bean.recipe_temp_c)) });
            if (from) return t("from {roaster}", { roaster: from });
            return bean.recipe_temp_c ? t("from the roaster, water {temp} °C", { temp: num(Number(bean.recipe_temp_c)) }) : t("from the roaster");
          })()
        : draft.start === 'standard' && bean
          ? { hell: t("usual for light roasts"), mittel: t("usual for medium roasts"), dunkel: t("usual for dark roasts") }[roastLevelOf(bean).level]
          : null;
  const labels = [t("Under-extracted"), t("Balanced"), t("Over-extracted")];

  const cancel = () => {
    setDraft(null);
    router.back();
  };

  const values = (taste: Pick<Cup, 'sweetness' | 'acidity' | 'body' | 'aromas'>) => ({
    coffee_id: draft.coffeeId,
    grind: draft.grind,
    dose_g: draft.dose_g,
    yield_g: draft.yield_g,
    time_s: draft.time_s,
    extraction: draft.extraction,
    ...taste,
  });

  // Editing: keep the stored taste and go back to the cup.
  const saveChanges = async () => {
    if (!editing) return;
    setSaveError(false);
    try {
      await updateCup(editing.id, values({ sweetness: editing.sweetness, acidity: editing.acidity, body: editing.body, aromas: editing.aromas }));
    } catch {
      setSaveError(true);
      return;
    }
    setDraft(null);
    router.back();
  };

  const saveRecipeOnly = async () => {
    setSaveError(false);
    const noTaste = { sweetness: null, acidity: null, body: null, aromas: [] };
    if (saving) return;
    // After a failed (or still running) write the cup exists already: the draft carries its id, so this
    // screen and the taste screen change that cup instead of adding a second one.
    const target = saveTarget(draft);
    let id: string;
    let written: Promise<void>;
    if (target.kind === 'update') {
      id = target.id;
      written = updateCup(id, values(noTaste));
    } else {
      const added = saveCup(values(noTaste));
      id = added.id;
      written = added.saved;
      setDraft(withNewCup(draft, id));
    }
    setSaving(true);
    try {
      await written;
    } catch {
      setSaveError(true);
      return;
    } finally {
      setSaving(false);
    }
    setDraft(null);
    // Back from the new cup should land on the tabs, not on whatever opened the recipe.
    router.dismissAll();
    router.push({ pathname: '/tasse/[id]', params: { id } });
  };

  return (
    <Screen
      scrollEnabled={!dragging}
      gap={compact ? 9 : 14}
      footer={
        <>
          {saveError ? (
            <T accessibilityRole="alert" style={{ fontSize: 13, color: colors.accent, textAlign: 'center' }}>
              {t("Could not save on this device. Your entry is not lost yet: try again before closing the app.")}
            </T>
          ) : null}
          <PrimaryButton label={t("Continue to taste")} onPress={() => router.push('/log/geschmack')} />
          <View style={{ alignItems: 'center' }}>
            {editing ? (
              <TextButton label={t("Save changes")} underline onPress={saveChanges} style={{ color: colors.muted, fontFamily: fonts.ui }} />
            ) : (
              <TextButton label={t("Save recipe only")} underline onPress={saveRecipeOnly} style={{ color: colors.muted, fontFamily: fonts.ui }} />
            )}
          </View>
        </>
      }
    >
      <NavHeader left={{ label: t("Cancel"), onPress: cancel }} title={t("Recipe")} right="1 / 2" steps={[true, false]} />

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: compact ? 8 : 12 }}>
        <BeanPhoto coffee={bean} size={64} />
        <View style={{ flex: 1 }}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <T style={{ fontFamily: fonts.serifSemi, fontSize: 21, lineHeight: 24 }} numberOfLines={1}>
            {bean?.name ?? t("Coffee")}
          </T>
          {bean?.roaster_id ? (
            <T style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
              {roasterName(bean.roaster_id)}
            </T>
          ) : null}
        </View>
        <TextButton label={t("Change")} underline onPress={() => router.push({ pathname: '/bohne/waehlen', params: { from: 'rezept' } })} />
      </Card>

      <GrindDial value={draft.grind} onChange={(grind) => set({ grind })} onDragging={setDragging} size={height < 700 ? 140 : height < 740 ? 170 : height < 780 ? 184 : 200} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stepper
          compact={compact}
          label={t("Dose")}
          value={num(draft.dose_g) + ' g'}
          onMinus={() => set({ dose_g: Math.max(1, draft.dose_g - 0.5) })}
          onPlus={() => set({ dose_g: draft.dose_g + 0.5 })}
        />
        <Stepper
          compact={compact}
          label={t("Yield")}
          value={num(draft.yield_g) + ' g'}
          onMinus={() => set({ yield_g: Math.max(1, draft.yield_g - 1) })}
          onPlus={() => set({ yield_g: draft.yield_g + 1 })}
        />
        <Stepper compact={compact} label={t("Time")} value={draft.time_s + ' s'} onMinus={() => set({ time_s: Math.max(0, draft.time_s - 1) })} onPlus={() => set({ time_s: draft.time_s + 1 })} />
      </View>
      <T style={{ textAlign: 'center', fontSize: 12, color: colors.muted }}>
        {t("Ratio {ratio}", { ratio: ratio(draft.dose_g, draft.yield_g) })}
        {startNote ? ' · ' + startNote : ''}
      </T>

      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T style={{ fontFamily: fonts.uiMedium }}>{t("Extraction")}</T>
          <T style={{ fontSize: 12, color: colors.muted }}>{extractionHint(draft.extraction)}</T>
        </View>
        <Slider label={t("Extraction")} value={draft.extraction} onChange={(extraction) => set({ extraction })} onDragging={setDragging} zones />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {labels.map((l) => {
            const on = extractionLabel(draft.extraction) === l;
            return (
              <T key={l} style={{ fontSize: 11, color: on ? colors.text : colors.muted, fontFamily: on ? fonts.uiMedium : fonts.ui }}>
                {l}
              </T>
            );
          })}
        </View>
      </View>
    </Screen>
  );
}
