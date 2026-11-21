import { processLabel } from '../../i18n/coffeeLabels';
import { t, useLanguage, translateMessage } from '../../i18n';
import { flavourNotes } from '../../i18n/notes';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, TextInput, View } from 'react-native';

import { beanSubtitle } from '../../components/BeanCard';
import { BeanPhoto } from '../../components/BeanPhoto';
import { CommunityBadge } from '../../components/CommunityBadge';
import { CameraIcon } from '../../components/icons';
import { Brand, Card, Chip, Eyebrow, Field, NavHeader, Pill, PrimaryButton, Screen, T, TextButton } from '../../components/ui';
import { useStore } from '../../data/store';
import type { Coffee, Recipe } from '../../data/types';
import { switchBean } from '../../lib/draft';
import { dateInput, parseDate, roastDateMessage } from '../../lib/format';
import { coffeeNameProblem, estimateRoastLevel } from '../../lib/validate';
import { keepPhoto } from '../../lib/photos';
import { photoFiles } from '../../data/photoFiles';
import * as Crypto from 'expo-crypto';
import { lookUpOnline, matchCatalog, scanBag, ScanError, toRecipe, type Online, type ScanResult } from '../../lib/scan';
import { colors, fonts } from '../../theme';

const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerob'];

type ScanState = { state: 'idle' } | { state: 'reading' } | { state: 'done'; filled: string[]; unsure: string[] } | { state: 'error'; message: string };
type OnlineState = { state: 'idle' } | { state: 'searching' } | { state: 'filled'; url: string } | { state: 'offer'; online: Online } | { state: 'none' };

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

export default function NeueBohne() {
  useLanguage();
  const ROASTS = [
    { key: 'hell', label: t("Light") },
    { key: 'mittel', label: t("Medium") },
    { key: 'dunkel', label: t("Dark") },
  ];

  const params = useLocalSearchParams<{ name?: string; from?: string; scan?: string }>();
  const { createCoffee, updateCoffee, roasters, draft, setDraft, cups, allCoffees, roasterName, addBean, updateBean } = useStore();
  const [name, setName] = useState(params.name ?? '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [roaster, setRoaster] = useState('');
  const [roasterFocus, setRoasterFocus] = useState(false);
  const [date, setDate] = useState('');
  const [origin, setOrigin] = useState('');
  const [process, setProcess] = useState<string | null>(null);
  const [roast, setRoast] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [variety, setVariety] = useState('');
  const [extra, setExtra] = useState<{ region: string | null; producer: string | null; roastFor: ScanResult['roast_for']; recipe?: Recipe | null }>({ region: null, producer: null, roastFor: null, recipe: null });
  const [scan, setScan] = useState<ScanState>({ state: 'idle' });
  const [match, setMatch] = useState<{ coffee: Coffee; roastDate: string | null } | null>(null);
  const [online, setOnline] = useState<OnlineState>({ state: 'idle' });
  const [onlineFilled, setOnlineFilled] = useState<string[]>([]);
  const [remotePhoto, setRemotePhoto] = useState<string | null>(null);
  const [productUrl, setProductUrl] = useState<string | null>(null);
  const autoScanned = useRef(false);
  const lastScan = useRef<ScanResult | null>(null);
  const scanCount = useRef(0);
  const savedId = useRef<string | null>(null);
  // Fields the last scan or online lookup filled in; a new scan clears them, so nothing of the previous bag stays.
  const autoFilled = useRef<string[]>([]);
  // The online lookup answers seconds later; it reads the form as it is then, not as it was when it started.
  const form = useRef({ name, roaster, origin, variety, process, roast, notes });
  useEffect(() => {
    form.current = { name, roaster, origin, variety, process, roast, notes };
  });

  const roastIso = date.trim() ? parseDate(date) : null;
  const dateMessage = roastDateMessage(date);
  const dateInvalid = !!dateMessage;
  // Same rule as the server: a name it would refuse ("☕") is never saved, so it can't hold up the sync.
  const nameProblem = coffeeNameProblem(name);
  const canSave = !nameProblem && !dateInvalid;

  const suggestions = useMemo(() => {
    const q = roaster.trim().toLowerCase();
    if (!q || !roasterFocus) return [];
    return roasters.filter((r) => r.name.toLowerCase().includes(q) && r.name.toLowerCase() !== q).slice(0, 4);
  }, [roaster, roasterFocus, roasters]);

  const pick = async (camera: boolean) => {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1] };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const res = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  };

  const leave = (id: string, bean?: Coffee) => {
    if (params.from === 'rezept' || params.from === 'start') {
      setDraft(switchBean(draft, id, cups, bean ?? allCoffees.find((c) => c.id === id)));
      router.dismissTo('/log/rezept');
    } else {
      router.replace({ pathname: '/bohne/[id]', params: { id } });
    }
  };

  const fill = (r: ScanResult) => {
    const filled: string[] = [];
    const put = (key: string, value: string | null | undefined, set: (v: string) => void) => {
      if (value) {
        set(value);
        filled.push(key);
      }
    };
    put('name', r.name, setName);
    put('roaster', r.roaster, setRoaster);
    put('date', r.roast_date ? dateInput(r.roast_date) : null, setDate);
    put('origin', [r.origin_country, r.region].filter(Boolean).join(', '), setOrigin);
    put('variety', r.variety, setVariety);
    if (r.process) {
      setProcess(r.process);
      filled.push('process');
    }
    if (r.roast_level) {
      setRoast(r.roast_level);
      filled.push('roast');
    }
    const scanned = flavourNotes(r.notes);
    if (scanned.length) {
      setNotes(scanned);
      filled.push('notes');
    }
    setExtra({ region: r.region, producer: r.producer, roastFor: r.roast_for, recipe: toRecipe(r.espresso_recipe) });
    autoFilled.current = filled;
    const unsure = (['name', 'roaster', 'origin_country'] as const).filter((k) => r.confidence[k] !== 'high' && r[k]).map((k) => (k === 'origin_country' ? 'origin' : k));
    return { filled, unsure };
  };

  /** Fills only what is still empty; what was read from the bag or typed in wins. */
  const applyOnline = ({ result: o, image_url }: Online) => {
    const f = form.current;
    const added: string[] = [];
    const put = (key: string, empty: boolean, value: string | null | undefined, set: (v: string) => void) => {
      if (empty && value) {
        set(value);
        added.push(key);
      }
    };
    put('roaster', !f.roaster.trim(), o.roaster, setRoaster);
    put('origin', !f.origin.trim(), [o.origin_country, o.region].filter(Boolean).join(', '), setOrigin);
    put('variety', !f.variety.trim(), o.variety, setVariety);
    put('process', !f.process, o.process && PROCESSES.includes(o.process) ? o.process : null, setProcess);
    put('roast', !f.roast, o.roast_level, setRoast);
    const shopNotes = flavourNotes(o.notes);
    if (!f.notes.length && shopNotes.length) {
      setNotes(shopNotes);
      added.push('notes');
    }
    setExtra((e) => ({ region: e.region ?? o.region, producer: e.producer ?? o.producer, roastFor: e.roastFor ?? o.roast_for, recipe: e.recipe ?? toRecipe(o.espresso_recipe) }));
    if (image_url) setRemotePhoto(image_url);
    setProductUrl(o.product_url);
    setOnlineFilled(added);
    autoFilled.current = [...autoFilled.current, ...added];
    setOnline({ state: 'filled', url: o.product_url! });
  };

  /** After saving, a late answer still completes the saved bean, but only a sure one. */
  const applyOnlineToSaved = (id: string, { result: o, image_url }: Online) =>
    updateCoffee(id, (c) => ({
      origin_country: c.origin_country || o.origin_country,
      region: c.region || o.region,
      producer: c.producer || o.producer,
      variety: c.variety || o.variety,
      process: c.process || (o.process && PROCESSES.includes(o.process) ? o.process : null),
      // An estimated level gives way to the one the shop names.
      ...(!c.roast_level || c.roast_level_estimated
        ? o.roast_level
          ? { roast_level: o.roast_level, roast_level_estimated: false }
          : { roast_level: estimateRoastLevel(c.roast_for || o.roast_for), roast_level_estimated: true }
        : {}),
      roast_for: c.roast_for || o.roast_for,
      ...(c.recipe_dose_g && c.recipe_yield_g ? {} : toRecipe(o.espresso_recipe) ?? {}),
      roaster_notes: c.roaster_notes.length ? c.roaster_notes : flavourNotes(o.notes),
      photo_path: image_url ?? c.photo_path,
      product_url: o.product_url,
    }));

  /** Empties what the previous scan or lookup put into the form; what was typed by hand stays. */
  const clearAutoFilled = () => {
    const clear: Record<string, () => void> = {
      name: () => setName(''),
      roaster: () => setRoaster(''),
      date: () => setDate(''),
      origin: () => setOrigin(''),
      variety: () => setVariety(''),
      process: () => setProcess(null),
      roast: () => setRoast(null),
      notes: () => setNotes([]),
    };
    autoFilled.current.forEach((key) => clear[key]?.());
    autoFilled.current = [];
  };

  const startLookup = async (result: ScanResult) => {
    const run = scanCount.current;
    setOnline({ state: 'searching' });
    const found = await lookUpOnline(result);
    if (run !== scanCount.current) return;
    if (savedId.current) {
      if (found?.sure) applyOnlineToSaved(savedId.current, found);
      return;
    }
    if (!found) setOnline({ state: 'none' });
    else if (found.sure) applyOnline(found);
    else setOnline({ state: 'offer', online: found });
  };

  const scanPackage = async () => {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    let res: ImagePicker.ImagePickerResult;
    if (Platform.OS === 'web') {
      res = await ImagePicker.launchImageLibraryAsync(options);
    } else {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setScan({ state: 'error', message: "Camera access is needed to scan a bag. You can enable it in your device settings." });
        return;
      }
      res = await ImagePicker.launchCameraAsync(options);
    }
    const asset = !res.canceled ? res.assets[0] : null;
    if (!asset) return;
    scanCount.current++;
    setPhoto(asset.uri);
    setMatch(null);
    setOnline({ state: 'idle' });
    setOnlineFilled([]);
    setRemotePhoto(null);
    setProductUrl(null);
    setScan({ state: 'reading' });
    try {
      const { result, photo: cropped } = await scanBag(asset.uri, { width: asset.width, height: asset.height });
      if (!result.is_coffee_bag) {
        setScan({ state: 'error', message: "No coffee bag was recognised. Try a photo of the front of the bag." });
        return;
      }
      const found = matchCatalog(result, allCoffees, roasterName);
      clearAutoFilled();
      const { filled, unsure } = fill(result);
      setPhoto(cropped);
      lastScan.current = result;
      if (found) setMatch({ coffee: found, roastDate: result.roast_date });
      else if (result.name) startLookup(result);
      setScan({ state: 'done', filled, unsure });
    } catch (e) {
      setScan({ state: 'error', message: e instanceof ScanError ? e.message : "The bag could not be read. Please try again." });
    }
  };

  useEffect(() => {
    // Coming from "Packung scannen" on the bean picker: open the camera right away.
    if (params.scan && !autoScanned.current) {
      autoScanned.current = true;
      scanPackage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const takeMatch = () => {
    if (!match) return;
    addBean(match.coffee.id);
    if (match.roastDate && !roastDateMessage(match.roastDate)) updateBean(match.coffee.id, { roast_date: match.roastDate });
    leave(match.coffee.id);
  };

  const notTheMatch = () => {
    setMatch(null);
    if (lastScan.current?.name) startLookup(lastScan.current);
  };

  const ai = (key: string) => (scan.state === 'done' && scan.filled.includes(key)) || onlineFilled.includes(key);
  const unsure = (key: string) => scan.state === 'done' && scan.unsure.includes(key);
  const aiStyle = (key: string) => (unsure(key) ? { borderColor: colors.kraft, backgroundColor: colors.unsureBg } : undefined);

  const addNote = () => {
    const n = note.trim();
    if (n && !notes.includes(n)) setNotes([...notes, n]);
    setNote('');
  };

  const [photoError, setPhotoError] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (withPhoto = true) => {
    if (!canSave || saving) return;
    // The picker's file is in the cache, which the system may empty: copy it into the app's folder first.
    let photoUri: string | null = null;
    if (photo && withPhoto) {
      setSaving(true);
      try {
        photoUri = await keepPhoto(photo, photoFiles, Crypto.randomUUID());
      } catch {
        setSaving(false);
        setPhotoError(true);
        return;
      }
      setSaving(false);
    }
    setPhotoError(false);
    const pending = note.trim() && !notes.includes(note.trim()) ? [...notes, note.trim()] : notes;
    // The scan shows "Land, Region" in one field; region is stored on its own, so keep it out of the country.
    const suffix = extra.region ? ', ' + extra.region : '';
    const country = suffix && origin.trim().endsWith(suffix) ? origin.trim().slice(0, -suffix.length) : origin;
    const id = createCoffee({
      name,
      roasterName: roaster,
      origin: country,
      region: extra.region,
      producer: extra.producer,
      variety,
      roastFor: extra.roastFor,
      process: process ?? undefined,
      roastLevel: roast ?? undefined,
      recipe: extra.recipe,
      notes: pending,
      photoUri,
      photoPath: remotePhoto,
      productUrl,
      roastDate: roastIso,
    });
    if (online.state === 'searching') savedId.current = id;
    // The store's list is not updated in this render yet: the first cup starts from what was just saved.
    leave(id, {
      id,
      roaster_id: null,
      name,
      roast_for: extra.roastFor,
      roast_level: roast ?? estimateRoastLevel(extra.roastFor),
      roast_level_estimated: !roast,
      roaster_notes: [],
      ...(extra.recipe ?? {}),
    });
  };

  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {photoError ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <T accessibilityRole="alert" style={{ fontSize: 13, color: colors.accent, textAlign: 'center' }}>
                {t("The photo could not be stored on this device.")}
              </T>
              <TextButton label={t("Save without photo")} underline onPress={() => save(false)} />
            </View>
          ) : null}
          <PrimaryButton
            label={canSave ? (photoError ? t("Try again") : t("Save coffee")) : dateInvalid ? t("Check the roast date") : translateMessage(nameProblem ?? "Enter a name first")}
            disabled={!canSave || saving}
            onPress={() => save()}
          />
        </View>
      }
    >
      <Brand />
      <NavHeader left={{ label: t("← Back"), onPress: () => router.back() }} title={t("New coffee")} />

      {scan.state === 'reading' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, backgroundColor: colors.neutral }}>
          <ActivityIndicator color={colors.accent} />
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: fonts.uiMedium }}>{t("Reading the bag …")}</T>
            <T style={{ fontSize: 12, color: colors.muted }}>{t("Name, roaster, origin and tasting notes")}</T>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={scanPackage}
          accessibilityRole="button"
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, backgroundColor: colors.accent }, pressed && { opacity: 0.85 }]}
        >
          <CameraIcon />
          <View style={{ flex: 1 }}>
            <T style={{ fontFamily: fonts.uiSemi, fontSize: 16, color: colors.onAccent }}>{scan.state === 'done' ? t("Scan again") : t("Scan a bag")}</T>
            <T style={{ fontSize: 12, color: colors.onAccent, opacity: 0.85 }}>{t("Take a photo and we’ll fill in the details")}</T>
          </View>
        </Pressable>
      )}

      {scan.state === 'error' ? <T style={{ fontSize: 13, color: colors.accent }}>{translateMessage(scan.message)}</T> : null}

      {match ? (
        <Card style={{ gap: 12 }}>
          <Eyebrow>{t("Found in the catalogue")}</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <BeanPhoto coffee={match.coffee} size={64} />
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: fonts.serifSemi, fontSize: 22, lineHeight: 25 }}>{match.coffee.name}</T>
              <T style={{ fontSize: 12, color: colors.muted }}>{beanSubtitle(roasterName(match.coffee.roaster_id), match.coffee.process, null)}</T>
            </View>
          </View>
          <CommunityBadge coffee={match.coffee} />
          <PrimaryButton label={t("Use this coffee")} onPress={takeMatch} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label={t("It’s a different coffee — add it manually")} underline onPress={notTheMatch} style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }} />
          </View>
        </Card>
      ) : null}

      {scan.state === 'done' && !match ? (
        <T style={{ fontSize: 12, color: colors.muted }}>
          {scan.unsure.length ? t("✦ Read from the bag. Please check the highlighted fields.") : t("✦ Read from the bag. Check the details, then save.")}
        </T>
      ) : null}

      {!match && online.state === 'searching' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={colors.muted} />
          <T style={{ fontSize: 12, color: colors.muted }}>{t("Looking for the coffee in the roaster’s shop …")}</T>
        </View>
      ) : null}

      {!match && online.state === 'filled' ? (
        <Pressable onPress={() => Linking.openURL(online.url)} accessibilityRole="link" hitSlop={6}>
          <T style={{ fontSize: 12, color: colors.muted }}>
            {onlineFilled.length || remotePhoto ? t("Details added online") : t("Verified online")} · <T style={{ fontSize: 12, color: colors.accent, textDecorationLine: 'underline' }}>{host(online.url)}</T>
          </T>
        </Pressable>
      ) : null}

      {!match && online.state === 'offer' ? (
        <Card style={{ gap: 10 }}>
          <Eyebrow>{t("Possible online match")}</Eyebrow>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {online.online.image_url ? <Image source={{ uri: online.online.image_url }} resizeMode="contain" style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.card }} /> : null}
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: fonts.uiMedium }}>{online.online.result.name ?? name}</T>
              <Pressable onPress={() => Linking.openURL(online.online.result.product_url!)} accessibilityRole="link" hitSlop={6}>
                <T style={{ fontSize: 12, color: colors.accent, textDecorationLine: 'underline' }}>{host(online.online.result.product_url!)}</T>
              </Pressable>
            </View>
          </View>
          <PrimaryButton label={t("Use this photo and these details")} onPress={() => applyOnline(online.online)} />
          <View style={{ alignItems: 'center' }}>
            <TextButton label={t("It’s a different coffee")} underline onPress={() => setOnline({ state: 'none' })} style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }} />
          </View>
        </Card>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontFamily: fonts.uiMedium }}>{ai('name') ? t("Name ✦") : t("Name")}</T>
          <Eyebrow style={{ color: colors.accent }}>{t("Required")}</Eyebrow>
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("e.g. Ethiopia Guji")}
          placeholderTextColor={colors.muted}
          autoFocus={!params.name && !params.scan}
          style={[
            { height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.card, paddingHorizontal: 14, fontFamily: fonts.serifSemi, fontSize: 22, color: colors.text },
            unsure('name') && { backgroundColor: colors.unsureBg },
          ]}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Eyebrow>{t("Optional")}</Eyebrow>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>

      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Pressable
          onPress={() => pick(false)}
          accessibilityRole="button"
          accessibilityLabel={t("Choose a bag photo")}
          style={{ width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.kraft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.card }}
        >
          {remotePhoto ? (
            <Image source={{ uri: remotePhoto }} resizeMode="contain" onError={() => setRemotePhoto(null)} style={{ width: 72, height: 72 }} />
          ) : photo ? (
            <Image source={{ uri: photo }} style={{ width: 72, height: 72 }} />
          ) : (
            <T style={{ fontSize: 22, color: colors.muted }}>＋</T>
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ fontFamily: fonts.uiMedium }}>{t("Bag photo")}</T>
          <T style={{ fontSize: 12, color: colors.muted }}>{t("helps you recognise your coffee")}</T>
          {Platform.OS !== 'web' ? (
            <Pressable onPress={() => pick(true)} hitSlop={6} accessibilityRole="button">
              <T style={{ fontSize: 12, color: colors.accent, fontFamily: fonts.uiMedium }}>{t("Take a photo")}</T>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Field
          label={ai('roaster') ? t("Roaster ✦") : t("Roaster")}
          style={aiStyle('roaster')}
          value={roaster}
          onChangeText={setRoaster}
          onFocus={() => setRoasterFocus(true)}
          onBlur={() => setTimeout(() => setRoasterFocus(false), 150)}
          placeholder={t("e.g. Bonanza")}
          autoCorrect={false}
        />
        {suggestions.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((r) => (
              <Pill
                key={r.id}
                label={r.name}
                onPress={() => {
                  setRoaster(r.name);
                  setRoasterFocus(false);
                }}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Field label={ai('date') ? t("Roast date ✦") : t("Roast date")} value={date} onChangeText={setDate} placeholder={t("DD/MM/YYYY")} keyboardType="numbers-and-punctuation" />
        {dateMessage ? <T style={{ fontSize: 12, color: colors.accent }}>{dateMessage}</T> : null}
      </View>

      <Field label={ai('origin') ? t("Origin ✦") : t("Origin")} style={aiStyle('origin')} value={origin} onChangeText={setOrigin} placeholder={t("e.g. Ethiopia, Guji")} />

      <Field label={ai('variety') ? t("Variety ✦") : t("Variety")} value={variety} onChangeText={setVariety} placeholder={t("e.g. SL28, Heirloom")} />

      <View style={{ gap: 8 }}>
        <T style={{ fontFamily: fonts.uiMedium }}>{ai('process') ? t("Processing ✦") : t("Processing")}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PROCESSES.map((p) => (
            <Pill key={p} label={processLabel(p)} active={process === p} onPress={() => setProcess(process === p ? null : p)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T style={{ fontFamily: fonts.uiMedium }}>{ai('roast') ? t("Roast level ✦") : t("Roast level")}</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {ROASTS.map((r) => (
            <Pill key={r.key} label={r.label} active={roast === r.key} onPress={() => setRoast(roast === r.key ? null : r.key)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T style={{ fontFamily: fonts.uiMedium }}>{ai('notes') ? t("Roaster’s tasting notes ✦") : t("Roaster’s tasting notes")}</T>
        {notes.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {notes.map((n) => (
              <Chip key={n} label={n} onRemove={() => setNotes(notes.filter((x) => x !== n))} />
            ))}
          </View>
        ) : null}
        <TextInput
          value={note}
          onChangeText={setNote}
          onSubmitEditing={addNote}
          onBlur={addNote}
          placeholder={t("+ Tasting note from the bag")}
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          submitBehavior="submit"
          style={{ height: 44, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.kraft, paddingHorizontal: 14, fontFamily: fonts.ui, fontSize: 13, color: colors.text }}
        />
      </View>
    </Screen>
  );
}
