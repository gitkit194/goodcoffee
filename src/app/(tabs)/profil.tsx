import { t, useLanguage, translateMessage } from '../../i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { ChevronIcon } from '../../components/icons';
import { Brand, Card, Eyebrow, Screen, T } from '../../components/ui';
import { REFUSED_REASON } from '../../lib/backup';
import { useStore } from '../../data/store';
import { aromaName, aromaCategory, normalizeAromaKey } from '../../lib/coffee';
import { monthYear, num } from '../../lib/format';
import { colors, fonts } from '../../theme';


export default function Profil() {
  const { preference } = useLanguage();
  const languageLabel = preference === 'system' ? t('Device language') : preference === 'en' ? 'English' : 'Deutsch';

  const { profile, updateProfile, cups, myBeans, backup, syncNow } = useStore();
  const rated = myBeans.filter((b) => b.bean.rating);
  const avg = rated.length ? rated.reduce((s, b) => s + (b.bean.rating ?? 0), 0) / rated.length : null;

  const counts = new Map<string, number>();
  cups.forEach((c) => c.aromas.forEach((a) => counts.set(aromaCategory(a), (counts.get(aromaCategory(a)) ?? 0) + 1)));
  // Sub-aromas like "sweet:Karamell" are worth showing on their own.
  cups.forEach((c) => c.aromas.map(normalizeAromaKey).filter((a) => a.startsWith('sweet:')).forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1)));
  const aromaRows = Array.from(counts.entries())
    .filter(([k]) => k !== 'sweet')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const max = aromaRows[0]?.[1] ?? 1;

  const since = monthYear(profile.since);
  const subtitle = [t("Since {month}", { month: since }), profile.grinder].filter(Boolean).join(' · ');
  const syncText =
    backup.state === 'local' ? t("Only on this device")
    : backup.state === 'uploading' ? t("Uploading …")
    : backup.state === 'empty' ? t("Nothing to back up yet")
    : t("Uploaded");

  return (
    <Screen>
      <Brand />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.neutral, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ fontFamily: fonts.serifSemi, fontSize: 26 }}>{profile.name ? profile.name[0].toUpperCase() : '☕'}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: fonts.serifMedium, fontSize: 34, lineHeight: 38, color: profile.name ? colors.text : colors.muted }}>{profile.name || t("Your profile")}</T>
          <T style={{ fontSize: 12, color: colors.muted }}>{subtitle}</T>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          [t("Cups"), String(cups.length)],
          [t("Coffees"), String(myBeans.length)],
          [t("Avg. rating"), avg ? num(avg) : '–'],
        ].map(([l, v]) => (
          <Card key={l} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 6 }}>
            <Eyebrow>{l}</Eyebrow>
            <T style={{ fontFamily: fonts.serif, fontSize: 27, fontVariant: ['lining-nums'] }}>{v}</T>
          </Card>
        ))}
      </View>

      {aromaRows.length ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>{t("Your flavours")}</Eyebrow>
          {aromaRows.map(([k, n]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <T style={{ width: 96, fontSize: 13 }}>{aromaName(k)}</T>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
                <View style={{ width: `${(n / max) * 100}%`, height: 6, backgroundColor: colors.accent }} />
              </View>
              <T style={{ width: 24, textAlign: 'right', fontSize: 12, color: colors.muted }}>{n}</T>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <Eyebrow>{t("Settings")}</Eyebrow>
        <Pressable
          onPress={() => router.push('/settings/language')}
          accessibilityRole="button"
          accessibilityLabel={t('Language') + ': ' + languageLabel}
          style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line, opacity: pressed ? 0.7 : 1 })}
        >
          <T>{t('Language')}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <T style={{ color: colors.muted, flexShrink: 1 }}>{languageLabel}</T>
            <ChevronIcon />
          </View>
        </Pressable>
        <EditRow label={t("Name")} value={profile.name} placeholder={t("Your first name")} onSave={(name) => updateProfile({ name })} />
        <EditRow label={t("Grinder")} value={profile.grinder} placeholder={t("e.g. Eureka Mignon")} onSave={(grinder) => updateProfile({ grinder })} />
        <InfoRow label={t("New cups visible to")} value={t("Only me")} />
        <Pressable onPress={syncNow} accessibilityRole="button">
          <InfoRow label={t("Backup")} value={syncText} />
        </Pressable>
        {backup.state === 'local' ? <T style={{ fontSize: 12, color: colors.muted, paddingTop: 6 }}>{backup.reason === REFUSED_REASON ? translateMessage(backup.reason) : translateMessage(backup.reason) + " " + t("Your cups are stored on this device and will sync later.")}</T> : null}
      </View>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  useLanguage();
  return (
    <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <T>{label}</T>
      <T style={{ color: colors.muted }}>{value}</T>
    </View>
  );
}

function EditRow({ label, value, placeholder, onSave }: { label: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  useLanguage();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const commit = () => {
    setEditing(false);
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
    <Pressable
      onPress={() => {
        setText(value);
        setEditing(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={t("Edit {label}", { label })}
      style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      <T>{label}</T>
      {editing ? (
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          style={{ flex: 1, textAlign: 'right', fontFamily: fonts.ui, fontSize: 14, color: colors.text, paddingVertical: 8 }}
        />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T style={{ color: value ? colors.muted : colors.accent }}>{value || t("Add")}</T>
          <ChevronIcon />
        </View>
      )}
    </Pressable>
  );
}
