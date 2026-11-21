import { t, useLanguage } from '../../i18n';
import { flavourNotes, noteLabel } from '../../i18n/notes';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View, type ScrollViewInstance } from 'react-native';

import { AromaWheel } from '../../components/AromaWheel';
import { CheckIcon, ChevronIcon } from '../../components/icons';
import { Card, Chip, Eyebrow, NavHeader, PrimaryButton, Screen, Slider, StarPicker, T, Title } from '../../components/ui';
import { useStore } from '../../data/store';
import { beanPatch, shown, untouched, type FieldEdit } from '../../lib/beanForm';
import { saveTarget, withNewCup } from '../../lib/draft';
import { aromaName, noteMatches } from '../../lib/coffee';
import { colors, fonts } from '../../theme';


type Taste = { sweetness: number; acidity: number; body: number };

export default function Geschmack() {
  const { language } = useLanguage();
  const SLIDERS = [
    { key: 'sweetness', label: t("Sweetness"), left: t("low"), right: t("high") },
    { key: 'acidity', label: t("Acidity"), left: t("low"), right: t("high") },
    { key: 'body', label: t("Body"), left: t("light, tea-like"), right: t("heavy, creamy") },
  ] as const;

  const { draft, setDraft, bean: beanFor, coffee, roasterName, saveCup, updateCup, updateBean, retrySave, cups, cup } = useStore();
  // Editing an existing cup: start from its stored taste.
  const [editingId] = useState(draft?.cupId);
  const editing = editingId ? cup(editingId) : undefined;
  const [taste, setTaste] = useState<Taste>(() =>
    editing && editing.sweetness !== null && editing.acidity !== null && editing.body !== null
      ? { sweetness: editing.sweetness, acidity: editing.acidity, body: editing.body }
      : { sweetness: 5, acidity: 5, body: 5 },
  );
  const [aromas, setAromas] = useState<string[]>(() => editing?.aromas ?? []);
  const [aromaOpen, setAromaOpen] = useState(false);
  // Rating and notes belong to the bean, which a sync can merge with the shared bean while this screen is
  // open. Untouched fields follow the bean; only what the user changed here is written.
  const [ratingEdit, setRatingEdit] = useState<FieldEdit<number>>(untouched);
  const [commentEdit, setCommentEdit] = useState<FieldEdit<string>>(untouched);
  const [savedCoffeeId, setSavedCoffeeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!draft && !savedCoffeeId && !closing) router.back();
  }, [draft, savedCoffeeId, closing]);

  const coffeeId = draft?.coffeeId ?? savedCoffeeId;
  if (!coffeeId) return <Screen>{null}</Screen>;
  const c = coffee(coffeeId);
  const bean = beanFor(coffeeId);
  const rating = shown(ratingEdit, bean?.rating ?? 0);
  const comment = shown(commentEdit, bean?.comment ?? '');
  const saved = !!savedCoffeeId;

  const toggle = (k: string) => !saved && setAromas((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));

  const save = async () => {
    if (!draft || saving) return;
    const values = {
      coffee_id: draft.coffeeId,
      grind: draft.grind,
      dose_g: draft.dose_g,
      yield_g: draft.yield_g,
      time_s: draft.time_s,
      extraction: draft.extraction,
      ...taste,
      aromas,
    };
    setSaving(true);
    setSaveError(false);
    const writes: Promise<void>[] = [];
    // A cup this draft already added (failed or running write, here or on the recipe step) is changed,
    // not added again.
    const target = saveTarget(editingId ? { ...draft, cupId: editingId } : draft);
    if (target.kind === 'update') writes.push(updateCup(target.id, values));
    else {
      const added = saveCup(values);
      setDraft(withNewCup(draft, added.id));
      writes.push(added.saved);
    }
    const patch = beanPatch(bean, ratingEdit, commentEdit);
    if (patch) writes.push(updateBean(draft.coffeeId, patch));
    try {
      // Say "saved" only once it is on the phone, not just in memory.
      await Promise.all(writes);
    } catch {
      setSaving(false);
      setSaveError(true);
      return;
    }
    setSaving(false);
    if (editingId) {
      // Back to the corrected cup, skipping the recipe step.
      setClosing(true);
      setDraft(null);
      router.dismissTo({ pathname: '/tasse/[id]', params: { id: editingId } });
      return;
    }
    setSavedCoffeeId(draft.coffeeId);
    setDraft(null);
    setAromaOpen(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  const retry = async () => {
    setSaveError(false);
    try {
      await retrySave();
    } catch {
      setSaveError(true);
      return;
    }
    await save();
  };

  const done = () => {
    router.dismissAll();
    router.navigate('/tagebuch');
  };

  const notes = flavourNotes(c?.roaster_notes ?? []);
  const hits = notes.filter((n) => noteMatches(n, aromas)).length;
  const matchText =
    aromas.length === 0
      ? t("This is how the roaster describes this coffee. Do you recognise any of these flavours?")
      : hits === 0
        ? t("No matches, but now you have some flavours to look for next time.")
        : t("recognisedNotes", { hits, count: notes.length });

  return (
    <Screen
      scrollRef={scrollRef}
      scrollEnabled={!dragging}
      gap={12}
      footer={
        saved ? (
          <PrimaryButton label={t("Done")} onPress={done} />
        ) : (
          <View style={{ gap: 8 }}>
            {saveError ? (
              <T accessibilityRole="alert" style={{ fontSize: 13, color: colors.accent, textAlign: 'center' }}>
                {t("Could not save on this device. Your entry is not lost yet: try again before closing the app.")}
              </T>
            ) : null}
            <PrimaryButton
              label={saveError ? t("Try again") : editingId ? t("Save changes") : t("Save cup")}
              disabled={saving}
              onPress={saveError ? retry : save}
            />
          </View>
        )
      }
    >
      <NavHeader
        left={saved ? undefined : { label: t("← Back"), onPress: () => router.back() }}
        title={t("Taste")}
        right="2 / 2"
        steps={[true, true]}
      />
      <View style={{ gap: 6 }}>
        <Eyebrow>{t("Your impression")}</Eyebrow>
        <Title size={32}>{t("How does it taste?")}</Title>
      </View>

      <View style={{ gap: 16 }}>
        {SLIDERS.map((s) => (
          <View key={s.key} style={{ gap: 2 }}>
            <T>{s.label}</T>
            <Slider
              label={t("{label}: from {low} to {high}", { label: s.label, low: s.left, high: s.right })}
              value={taste[s.key]}
              onChange={(v) => setTaste((t) => ({ ...t, [s.key]: v }))}
              onDragging={setDragging}
              disabled={saved}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T style={{ fontSize: 11, color: colors.muted }}>{s.left}</T>
              <T style={{ fontSize: 11, color: colors.muted }}>{s.right}</T>
            </View>
          </View>
        ))}
      </View>

      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 4 }}>
        <Pressable
          onPress={() => setAromaOpen((o) => !o)}
          disabled={saved}
          accessibilityRole="button"
          accessibilityState={{ expanded: aromaOpen, disabled: saved }}
          style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View>
            <T style={{ fontFamily: fonts.uiMedium }}>{aromaOpen || saved ? t("Flavours") : t("Add flavours")}</T>
            <T style={{ fontSize: 11, color: colors.muted }}>{aromas.length ? t("{count} selected · optional", { count: aromas.length }) : t("optional")}</T>
          </View>
          {saved ? null : (
            <View style={{ transform: [{ rotate: aromaOpen ? '180deg' : '0deg' }] }}>
              <ChevronIcon down />
            </View>
          )}
        </Pressable>
        {aromaOpen ? (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <AromaWheel selected={aromas} onToggle={toggle} />
          </View>
        ) : null}
        {aromas.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 10 }}>
            {aromas.map((k) => (
              <Chip key={k} label={aromaName(k)} onRemove={saved ? undefined : () => toggle(k)} />
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontFamily: fonts.uiMedium }}>{t("Your coffee rating")}</T>
          <T style={{ fontSize: 12, color: colors.accent }}>{rating ? rating + ' / 5' : '– / 5'}</T>
        </View>
        <StarPicker value={rating} onChange={(value) => setRatingEdit({ touched: true, value })} disabled={saved} />
        <T style={{ fontSize: 11, color: colors.muted }}>{t("This rating is for the coffee, not just this cup.")}</T>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontFamily: fonts.uiMedium }}>{t("Coffee notes")}</T>
          <Eyebrow>{t("optional")}</Eyebrow>
        </View>
        <TextInput
          value={comment}
          onChangeText={(value) => setCommentEdit({ touched: true, value })}
          editable={!saved}
          placeholder={t("How does this coffee taste?")}
          // A note is short: the return key closes the keyboard instead of adding a line.
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          placeholderTextColor={colors.muted}
          multiline
          style={{
            minHeight: 64,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.card,
            padding: 14,
            fontFamily: fonts.ui,
            fontSize: 14,
            color: colors.text,
            textAlignVertical: 'top',
          }}
        />
      </View>

      {saved ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.successBg, borderRadius: 12, padding: 14 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
              <CheckIcon />
            </View>
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.success }}>{t("Saved")}</T>
              <T style={{ fontSize: 12, color: colors.success }}>{t("Cup {count} in your journal", { count: cups.length })}</T>
            </View>
          </View>
          {notes.length ? (
            <Card style={{ gap: 10 }}>
              <Eyebrow>{t("According to {roaster}", { roaster: roasterName(c?.roaster_id) || t("Roaster") })}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {notes.map((n) => (
                  <Chip key={n} label={noteLabel(n, language)} active={noteMatches(n, aromas)} />
                ))}
              </View>
              <T style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>{matchText}</T>
            </Card>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
