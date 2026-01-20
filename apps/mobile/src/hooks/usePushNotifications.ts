import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import {
  requestNotificationPermissions,
  registerPushToken,
  unregisterPushToken,
  getNotificationRoute,
  clearAllNotifications,
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
  const isRegisteredRef = useRef(false);

  // Handle notification response (user tapped on notification)
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      try {
        const data = response.notification.request.content.data as NotificationData;
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

      const success = await registerPushToken(userId);
      if (success) {
        isRegisteredRef.current = true;
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
      await unregisterPushToken();
      isRegisteredRef.current = false;
    } catch (error) {
      console.error("Error unregistering from push notifications:", error);
    }
  }, []);

  // Set up notification listeners and register
  useEffect(() => {
    if (!enabled) return;

    // Register for push notifications when user is authenticated
    if (userId) {
      register();
    }

    // Listen for notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification.request.content.title);
        // Optionally handle foreground notifications here
      }
    );

    // Listen for user interaction with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Clear badge when app is opened
    clearAllNotifications();

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [userId, enabled, register, handleNotificationResponse]);

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
