import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { captureException } from "./analytics";

// Notification types that map to web
export type NotificationType = "announcement" | "event";

export interface NotificationData {
  type: NotificationType;
  orgSlug: string;
  id: string;
  title?: string;
  body?: string;
}

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function getStableDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") {
      return await Application.getIosIdForVendorAsync();
    }
    if (Platform.OS === "android") {
      return Application.androidId ?? null;
    }
  } catch (error) {
    console.warn("Failed to resolve device id:", error);
  }
  return null;
}

/**
 * Request permission for push notifications
 */
export async function requestNotificationPermissions(): Promise<boolean> {
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
    const deviceId = stableDeviceId || Constants.deviceId || Device.modelName || "unknown";
    const platform = Platform.OS as "ios" | "android" | "web";

    if (stableDeviceId) {
      await supabase
        .from("user_push_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("device_id", stableDeviceId)
        .neq("expo_push_token", token);
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
 * Unregister push token (on logout)
 */
export async function unregisterPushToken(tokenOverride?: string): Promise<void> {
  const token = tokenOverride ?? await getExpoPushToken();
  if (!token) return;

  try {
    await supabase
      .from("user_push_tokens")
      .delete()
      .eq("expo_push_token", token);
  } catch (error) {
    console.error("Error unregistering push token:", error);
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
      return `/(app)/${data.orgSlug}/events/${data.id}`;
    default:
      return null;
  }
}

/**
 * Get the current badge count
 */
export async function getBadgeCount(): Promise<number> {
  return Notifications.getBadgeCountAsync();
}

/**
 * Set the badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

/**
 * Clear all notifications and reset badge
 */
export async function clearAllNotifications(): Promise<void> {
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
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data as unknown as Record<string, unknown>,
    },
    trigger: null, // Immediate
  });
}
