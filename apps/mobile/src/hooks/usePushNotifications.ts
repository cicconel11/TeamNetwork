import { useEffect, useRef, useCallback } from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import {
  requestNotificationPermissions,
  getExpoPushToken,
  registerPushToken,
  unregisterPushToken,
  getNotificationRoute,
  clearAllNotifications,
  getBadgeCount,
  setBadgeCount,
  type NotificationData,
} from "@/lib/notifications";
import { captureException } from "@/lib/analytics";

interface UsePushNotificationsOptions {
  userId: string | null;
  enabled?: boolean;
}

/**
 * Hook to manage push notification registration and response handling
 */
export function usePushNotifications({
  userId,
  enabled = true,
}: UsePushNotificationsOptions) {
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const pushTokenListener = useRef<Notifications.EventSubscription | null>(null);
  const isRegisteredRef = useRef(false);
  const lastTokenRef = useRef<string | null>(null);

  const incrementBadge = useCallback(async () => {
    try {
      const currentCount = await getBadgeCount();
      await setBadgeCount(currentCount + 1);
    } catch (error) {
      console.error("Error updating badge count:", error);
      captureException(error as Error, { context: "incrementBadge" });
    }
  }, []);

  // Handle notification response (user tapped on notification)
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      try {
        const data = response.notification.request.content.data as unknown as NotificationData;
        const route = getNotificationRoute(data);

        if (route) {
          // Navigate to the appropriate screen
          router.push(route as any);
        }
      } catch (error) {
        console.error("Error handling notification response:", error);
        captureException(error as Error, { context: "handleNotificationResponse" });
      }
    },
    [router]
  );

  // Register for push notifications
  const register = useCallback(async () => {
    if (!userId || !enabled || isRegisteredRef.current) return;

    try {
      const hasPermission = await requestNotificationPermissions();
      if (!hasPermission) {
        console.log("Push notification permission not granted");
        return;
      }

      const token = await getExpoPushToken();
      if (!token) return;

      const success = await registerPushToken(userId, token);
      if (success) {
        isRegisteredRef.current = true;
        lastTokenRef.current = token;
      }
    } catch (error) {
      console.error("Error registering for push notifications:", error);
      captureException(error as Error, { context: "registerPushNotifications" });
    }
  }, [userId, enabled]);

  // Unregister from push notifications
  const unregister = useCallback(async () => {
    if (!isRegisteredRef.current) return;

    try {
      await unregisterPushToken(lastTokenRef.current ?? undefined);
      isRegisteredRef.current = false;
      lastTokenRef.current = null;
    } catch (error) {
      console.error("Error unregistering from push notifications:", error);
    }
  }, []);

  // Set up notification listeners and register (native only; expo-notifications is not available on web)
  useEffect(() => {
    if (Platform.OS === "web" || !enabled) return;

    // Register for push notifications when user is authenticated
    if (userId) {
      register();
    }

    // Listen for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification.request.content.title);
        void incrementBadge();
        // Optionally handle foreground notifications here
      }
    );

    // Listen for push token refreshes
    pushTokenListener.current = Notifications.addPushTokenListener((token) => {
      if (!userId || !enabled) return;
      if (token.type !== "expo") return;
      if (typeof token.data !== "string") return;

      const nextToken = token.data;
      if (lastTokenRef.current === nextToken) return;

      const previousToken = lastTokenRef.current;
      lastTokenRef.current = nextToken;

      void registerPushToken(userId, nextToken).then((success) => {
        if (success) {
          isRegisteredRef.current = true;
          if (previousToken && previousToken !== nextToken) {
            void unregisterPushToken(previousToken);
          }
        }
      });
    });

    // Listen for user interaction with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Handle notification tap when app launches from a quit state
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    // Clear badge when app is opened
    clearAllNotifications();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void clearAllNotifications();
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      pushTokenListener.current?.remove();
      appStateSubscription.remove();
    };
  }, [userId, enabled, register, handleNotificationResponse, incrementBadge]);

  // Handle logout - unregister token
  useEffect(() => {
    if (!userId && isRegisteredRef.current) {
      unregister();
    }
  }, [userId, unregister]);

  return {
    register,
    unregister,
    isRegistered: isRegisteredRef.current,
  };
}
