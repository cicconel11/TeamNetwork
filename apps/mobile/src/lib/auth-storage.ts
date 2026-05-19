import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const SECURE_AUTH_STORAGE_PREFIX = "teammeet.auth";
export const SECURE_AUTH_STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.auth",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function buildStorageKey(key: string): string {
  return `${SECURE_AUTH_STORAGE_PREFIX}.${key}`;
}

// Auth tokens must live in the Keychain/Android Keystore. If SecureStore
// throws (e.g. missing entitlement), fail loudly rather than silently
// degrading to plaintext AsyncStorage — JWT exposure on disk is worse
// than a sign-in failure the user can recover from.
export const nativeSecureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(buildStorageKey(key), SECURE_AUTH_STORAGE_OPTIONS);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(buildStorageKey(key), value, SECURE_AUTH_STORAGE_OPTIONS);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(buildStorageKey(key), SECURE_AUTH_STORAGE_OPTIONS);
  },
};

export function getSupabaseStorage() {
  return Platform.OS === "web" ? undefined : nativeSecureAuthStorage;
}
