import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { logError } from '../lib/log';
import { createSecureSessionStorage, type KeyValueStore } from '../lib/secureStorage';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

// The session (access and refresh token) goes to the keychain (iOS) / keystore-encrypted storage
// (Android). AFTER_FIRST_UNLOCK so a start in the background after a reboot still finds it once the
// phone was unlocked. The web build has no secure store and keeps using the browser's storage.
const keychain: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const storage = Platform.OS === 'web' ? AsyncStorage : createSecureSessionStorage(keychain, AsyncStorage, (where, e) => logError(`Session storage (${where})`, e));

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the session only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
