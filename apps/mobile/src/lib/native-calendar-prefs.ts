/**
 * Per-org calendar-sync opt-in. Stored locally — calendar mirroring is a
 * device-scoped concept (different devices, different calendars).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "teammeet.calendar.sync.v1";

function flagKey(orgId: string): string {
  return `${KEY_PREFIX}.${orgId}`;
}

export async function isOrgCalendarSyncEnabled(orgId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(flagKey(orgId))) === "1";
}

export async function setOrgCalendarSyncEnabled(
  orgId: string,
  enabled: boolean
): Promise<void> {
  if (enabled) {
    await AsyncStorage.setItem(flagKey(orgId), "1");
  } else {
    await AsyncStorage.removeItem(flagKey(orgId));
  }
}
