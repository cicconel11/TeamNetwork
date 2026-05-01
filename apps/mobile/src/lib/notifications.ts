import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { captureException } from "./analytics";

// Notification types that map to web. `event_reminder` is the cron-driven
// 24h/1h reminder; `event_live_activity` is forward-compat for the iOS LA
// taps coming in P3 — both deep-link to the same event detail screen.
export type NotificationType =
  | "announcement"
  | "event"
  | "event_reminder"
  | "event_live_activity"
  | "chat"
  | "discussion"
  | "mentorship"
  | "donation"
  | "membership";

export interface NotificationData {
  type: NotificationType;
  orgSlug: string;
  id: string;
  title?: string;
  body?: string;
}

// Configure how notifications appear when app is in foreground (native only)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function getStableDeviceId(): Promise<string | null> {
  try {
    let rawId: string | null = null;
    if (Platform.OS === "ios") {
      rawId = await Application.getIosIdForVendorAsync();
    }
    if (Platform.OS === "android") {
      rawId = Application.getAndroidId() ?? null;
    }
    if (rawId) {
      return await hashDeviceIdentifier(rawId);
    }
  } catch (error) {
    console.warn("Failed to resolve device id:", error);
  }
  return null;
}

async function hashDeviceIdentifier(value: string): Promise<string | null> {
  if (!value) return null;

  try {
    return await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `push-device:${value}`
    );
  } catch (error) {
    console.warn("Failed to hash device id:", error);
    return null;
  }
}

/**
 * Request permission for push notifications
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!Device.isDevice) {
    console.log("Push notifications only work on physical devices");
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("Push notification permission not granted");
    return false;
  }

  // Set up Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563eb",
    });
  }

  return true;
}

/**
 * Get the Expo push token for this device
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) {
    console.log("Push tokens only available on physical devices");
    return null;
  }

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.error("Missing EAS project ID in app config");
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return token;
  } catch (error) {
    console.error("Failed to get push token:", error);
    captureException(error as Error, { context: "getExpoPushToken" });
    return null;
  }
}

/**
 * Register push token with the backend
 */
export async function registerPushToken(
  userId: string,
  tokenOverride?: string
): Promise<boolean> {
  const token = tokenOverride ?? await getExpoPushToken();
  if (!token) return false;

  try {
    const stableDeviceId = await getStableDeviceId();
    const fallbackDeviceId = await hashDeviceIdentifier(
      String(Constants.deviceId || Device.modelName || "")
    );
    const deviceId = stableDeviceId || fallbackDeviceId || "unknown";
    const platform = Platform.OS as "ios" | "android" | "web";

    if (stableDeviceId) {
      const { error: deleteError } = await supabase
        .from("user_push_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("device_id", stableDeviceId)
        .neq("expo_push_token", token);

      // Ignore table-not-found errors (push notifications not set up yet)
      if (deleteError && !isTableNotFoundError(deleteError)) {
        console.warn("Failed to clean up old push tokens:", deleteError.message);
      }
    }

    // Upsert the token (update if exists, insert if new)
    const { error } = await supabase
      .from("user_push_tokens")
      .upsert(
        {
          user_id: userId,
          expo_push_token: token,
          device_id: deviceId,
          platform,
        },
        {
          onConflict: "user_id,expo_push_token",
        }
      );

    if (error) {
      // Don't log errors for missing table - push notifications are optional
      if (isTableNotFoundError(error)) {
        console.log("Push notifications not configured (user_push_tokens table missing)");
        return false;
      }
      console.error("Failed to register push token:", error);
      captureException(new Error(error.message), { context: "registerPushToken" });
      return false;
    }

    console.log("Push token registered successfully");
    return true;
  } catch (error) {
    console.error("Error registering push token:", error);
    captureException(error as Error, { context: "registerPushToken" });
    return false;
  }
}

/**
 * Check if a Supabase error is a table-not-found error
 */
function isTableNotFoundError(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST205" || (error.message?.includes("Could not find the table") ?? false);
}

/**
 * Unregister push token (on logout)
 */
export async function unregisterPushToken(tokenOverride?: string): Promise<void> {
  const token = tokenOverride ?? await getExpoPushToken();
  if (!token) return;

  try {
    const { error } = await supabase
      .from("user_push_tokens")
      .delete()
      .eq("expo_push_token", token);

    // Ignore table-not-found errors silently
    if (error && !isTableNotFoundError(error)) {
      console.warn("Error unregistering push token:", error.message);
    }
  } catch (error) {
    console.warn("Error unregistering push token:", error);
  }
}

/**
 * Parse notification data into a route path for deep linking
 */
export function getNotificationRoute(data: NotificationData): string | null {
  if (!data.orgSlug || !data.type || !data.id) {
    return null;
  }

  switch (data.type) {
    case "announcement":
      return `/(app)/${data.orgSlug}/announcements/${data.id}`;
    case "event":
    case "event_reminder":
    case "event_live_activity":
      return `/(app)/${data.orgSlug}/events/${data.id}`;
    case "chat":
      // For chat, `id` is the chat group id; the messages screen lives at
      // /[orgSlug]/chat/[groupId]
      return `/(app)/${data.orgSlug}/chat/${data.id}`;
    case "discussion":
      return `/(app)/${data.orgSlug}/discussions/${data.id}`;
    case "mentorship":
      // `id` is the mentorship pair id (or the mentee/mentor request id).
      // The mentorship hub does its own resolution; we deep-link into it.
      return `/(app)/${data.orgSlug}/mentorship/${data.id}`;
    case "donation":
      // Org-admin only surface; donations dashboard lives under settings.
      return `/(app)/${data.orgSlug}/donations`;
    case "membership":
      return `/(app)/${data.orgSlug}/members`;
    default:
      return null;
  }
}

/**
 * Get the current badge count
 */
export async function getBadgeCount(): Promise<number> {
  if (Platform.OS === "web") return 0;
  return Notifications.getBadgeCountAsync();
}

/**
 * Set the badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.setBadgeCountAsync(count);
}

/**
 * Clear all notifications and reset badge
 */
export async function clearAllNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.dismissAllNotificationsAsync();
  await setBadgeCount(0);
}

/**
 * Schedule a local notification (useful for testing)
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: NotificationData
): Promise<string> {
  if (Platform.OS === "web") return "";
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data as unknown as Record<string, unknown>,
    },
    trigger: null, // Immediate
  });
}
