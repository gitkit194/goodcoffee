import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { isLanguagePreference, isMessageKey, resolveLanguage, translate, type Language, type LanguagePreference, type MessageKey, type MessageParams } from './core';

export type { Language, LanguagePreference, MessageKey } from './core';
const STORAGE_KEY = 'goodcoffee:language:v1';
let preference: LanguagePreference = 'system';
let deviceLanguages: string[] = [];
let language: Language = 'en';
const listeners = new Set<() => void>();
let initialisation: Promise<void> | undefined;
let saveQueue: Promise<void> = Promise.resolve();

function publish() {
  language = resolveLanguage(preference, deviceLanguages);
  listeners.forEach((listener) => listener());
}

export function setDeviceLanguages(tags: string[]) {
  deviceLanguages = tags;
  publish();
}

export function initialiseLanguage(): Promise<void> {
  return initialisation ??= AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
    if (isLanguagePreference(stored)) preference = stored;
    publish();
  }).catch(() => { publish(); });
}

export async function setLanguagePreference(next: LanguagePreference): Promise<void> {
  preference = next;
  publish();
  // Serialize writes so rapid switches cannot persist an older selection last.
  const save = saveQueue.catch(() => undefined).then(() => AsyncStorage.setItem(STORAGE_KEY, next));
  saveQueue = save;
  await save;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => `${preference}:${language}`;

/** Subscribe in components that render translated strings or locale-sensitive values. */
export function useLanguage() {
  useSyncExternalStore(subscribe, snapshot, () => 'system:en');
  return { language, preference, setLanguagePreference };
}

export function getLanguage(): Language { return language; }
export function getFormatLocale(): string { return language === 'de' ? 'de-DE' : 'en-GB'; }
export function t(key: MessageKey, params?: MessageParams): string { return translate(language, key, params); }
/** Only known application messages are translated; arbitrary user/server text stays untouched. */
export function translateMessage(message: string): string { return isMessageKey(message) ? t(message) : message; }
