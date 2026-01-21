/**
 * Web stub for usePushNotifications.
 * expo-notifications is not available on web; this avoids importing it entirely
 * so getLastNotificationResponse, dismissAllNotificationsAsync, etc. are never loaded.
 */
export function usePushNotifications(_options: {
  userId: string | null;
  enabled?: boolean;
}) {
  return {
    register: () => Promise.resolve(),
    unregister: () => Promise.resolve(),
    isRegistered: false,
  };
}
