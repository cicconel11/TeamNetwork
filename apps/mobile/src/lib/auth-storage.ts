import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export const SECURE_AUTH_STORAGE_PREFIX = "teammeet.auth";
export const SECURE_AUTH_STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.myteamnetwork.teammeet.auth",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function buildStorageKey(key: string): string {
  return `${SECURE_AUTH_STORAGE_PREFIX}.${key}`;
}

function isMissingEntitlementError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("required entitlement");
}

export const nativeSecureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const storageKey = buildStorageKey(key);
    try {
      return await SecureStore.getItemAsync(storageKey, SECURE_AUTH_STORAGE_OPTIONS);
    } catch (error) {
      if (!isMissingEntitlementError(error)) throw error;
      return AsyncStorage.getItem(storageKey);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const storageKey = buildStorageKey(key);
    try {
      await SecureStore.setItemAsync(storageKey, value, SECURE_AUTH_STORAGE_OPTIONS);
    } catch (error) {
      if (!isMissingEntitlementError(error)) throw error;
      await AsyncStorage.setItem(storageKey, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    const storageKey = buildStorageKey(key);
    try {
      await SecureStore.deleteItemAsync(storageKey, SECURE_AUTH_STORAGE_OPTIONS);
    } catch (error) {
      if (!isMissingEntitlementError(error)) throw error;
    } finally {
      await AsyncStorage.removeItem(storageKey);
    }
  },
};

export function getSupabaseStorage() {
  return Platform.OS === "web" ? undefined : nativeSecureAuthStorage;
}
