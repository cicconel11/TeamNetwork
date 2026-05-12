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
  dismissDeliveredNotifications,
  type NotificationData,
} from "@/lib/notifications";
import { captureException } from "@/lib/analytics";
import { useBiometricLock } from "@/contexts/BiometricLockContext";

const DEDUPE_TTL_MS = 60_000;

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
  const hasHandledColdLaunchRef = useRef(false);
  // Short-TTL dedupe: iOS can deliver the same response twice (cold-launch +
  // listener for the same payload, or rapid double-taps). A lifetime-scoped
  // ref silently swallowed legitimate re-taps after the user navigated away,
  // so we expire entries after DEDUPE_TTL_MS.
  const handledNotificationsRef = useRef<Map<string, number>>(new Map());
  const pendingRouteRef = useRef<string | null>(null);

  const { isLocked } = useBiometricLock();
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;

  // Stable handler: subscribed once, reads `isLocked` via ref so router
  // identity changes don't tear down + re-subscribe the listener (which on
  // rapid auth/nav re-renders caused duplicate response handling).
  const handlerRef = useRef<(response: Notifications.NotificationResponse) => void>(() => {});
  handlerRef.current = (response: Notifications.NotificationResponse) => {
    try {
      const id = response.notification.request.identifier;
      if (id) {
        const now = Date.now();
        // Sweep expired entries so the map can't grow unbounded.
        for (const [key, ts] of handledNotificationsRef.current) {
          if (now - ts > DEDUPE_TTL_MS) handledNotificationsRef.current.delete(key);
        }
        const seen = handledNotificationsRef.current.get(id);
        if (seen && now - seen <= DEDUPE_TTL_MS) return;
        handledNotificationsRef.current.set(id, now);
      }

      const data = response.notification.request.content.data as unknown as NotificationData;
      const route = getNotificationRoute(data);
      if (!route) return;

      // Defer routing while the biometric lock screen is up. Navigating
      // behind the LockScreen overlay caused the underlying screen to mount
      // mid-Face-ID prompt, producing the visible flicker. We replay the
      // route once the lock clears.
      if (isLockedRef.current) {
        pendingRouteRef.current = route;
        return;
      }
      router.push(route as any);
    } catch (error) {
      console.error("Error handling notification response:", error);
      captureException(error as Error, { context: "handleNotificationResponse" });
    }
  };

  // Flush any pending notification route once the lock clears.
  useEffect(() => {
    if (isLocked) return;
    const pending = pendingRouteRef.current;
    if (!pending) return;
    pendingRouteRef.current = null;
    router.push(pending as any);
  }, [isLocked, router]);

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

    // Foreground notifications no longer increment the badge; the inbox
    // unread count drives the badge via useNotifications.
    notificationListener.current = Notifications.addNotificationReceivedListener(
      () => {
        // Hook reserved for analytics / in-app banners.
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

    // Listen for user interaction with notifications. Subscribe with a stable
    // wrapper that reads the latest handler via ref — otherwise router
    // identity changes would re-subscribe per render and cause duplicate
    // response handling on rapid nav.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => handlerRef.current(response)
    );

    // Handle notification tap when app launches from a quit state. Expo
    // persists the cold-launch response until force-quit, so guard with a ref
    // — without this, every effect re-run re-navigates and the stack twitches.
    if (!hasHandledColdLaunchRef.current) {
      hasHandledColdLaunchRef.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) {
          handlerRef.current(response);
        }
      });
    }

    // Dismiss delivered banners from the OS center on launch and resume.
    // Badge count is left alone — useNotifications keeps it in sync with
    // the actual unread inbox count.
    dismissDeliveredNotifications();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void dismissDeliveredNotifications();
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      pushTokenListener.current?.remove();
      appStateSubscription.remove();
    };
  }, [userId, enabled, register]);

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
