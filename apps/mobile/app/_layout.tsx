import { useEffect, useCallback, useRef } from "react";
import { StyleSheet, Platform, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import { useFonts } from "expo-font";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ColorSchemeProvider } from "@/contexts/ColorSchemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { BiometricLockProvider } from "@/contexts/BiometricLockContext";
import { LiveActivityProvider } from "@/contexts/LiveActivityContext";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { setGlobalShowToast } from "@/components/ui/Toast";
import AuthLoadingScreen from "@/components/AuthLoadingScreen";
import { init as initAnalytics, identify, reset as resetAnalytics, captureException, hydrateEnabled } from "@/lib/analytics";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useScreenTracking } from "@/hooks/useScreenTracking";
import { useSupabaseAppState } from "@/hooks/useSupabaseAppState";
import { parseTeammeetUrl, routeIntent } from "@/lib/deep-link";
import {
  clearQuickActions,
  registerQuickActions,
  subscribeQuickActions,
} from "@/lib/quick-actions";

import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorState } from "@/components/ui/ErrorState";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  captureException(error, { context: "RootErrorBoundary" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <ErrorState
          onRetry={retry}
          title="Something went wrong"
          subtitle="The app encountered an unexpected error."
        />
      </View>
    </SafeAreaView>
  );
}

// Prevent splash screen from auto-hiding until fonts are loaded
SplashScreen.preventAutoHideAsync();
WebBrowser.maybeCompleteAuthSession();

// Suppress known third-party library warnings on web platform
// These are library compatibility issues that don't affect functionality
if (Platform.OS === "web") {
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: any[]) => {
    const message = args[0]?.toString?.() || "";
    // Suppress pointerEvents deprecation warning from react-native-reanimated
    if (message.includes("pointerEvents") || message.includes("Use style.pointerEvents")) {
      return;
    }
    // Suppress aria-hidden accessibility warning from @gorhom/bottom-sheet
    if (message.includes("aria-hidden") || message.includes("inert attribute")) {
      return;
    }
    originalWarn(...args);
  };
  console.error = (...args: any[]) => {
    const message = args[0]?.toString?.() || "";
    // React 19 warning triggered by react-native-web using element.ref internally
    if (message.includes("Accessing element.ref was removed in React 19")) {
      return;
    }
    originalError(...args);
  };
}

/**
 * RootLayout renders AuthProvider as the single source of truth for auth state.
 * RootLayoutInner consumes auth context for navigation, analytics, and deep links.
 * This avoids duplicate onAuthStateChange subscriptions.
 */
/**
 * ToastBridge wires the global imperative showToast() to the mounted ToastProvider.
 * This makes showToast() calls in data hooks (outside the React tree) work.
 */
function ToastBridge() {
  const { show } = useToast();
  useEffect(() => {
    setGlobalShowToast((msg, variant) => show(msg, variant));
    return () => setGlobalShowToast(null);
  }, [show]);
  return null;
}

export default function RootLayout() {
  return (
    <ColorSchemeProvider>
      <AuthProvider>
        <NetworkProvider>
          <BiometricLockProvider>
            <LiveActivityProvider>
              <RootLayoutInner />
            </LiveActivityProvider>
          </BiometricLockProvider>
        </NetworkProvider>
      </AuthProvider>
    </ColorSchemeProvider>
  );
}

function RootLayoutInner() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const { session, isLoading } = useAuth();
  const prevUserIdRef = useRef<string | undefined>(undefined);
  const [fontsLoaded] = useFonts({
    DMSerifDisplay_400Regular,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
  });

  // Track screen views automatically
  useScreenTracking();

  // Reconnect Supabase realtime when app returns from background
  useSupabaseAppState();

  // Initialize push notifications
  usePushNotifications({
    userId: session?.user?.id ?? null,
    enabled: true,
  });

  // Hide splash screen once fonts are loaded
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Initialize analytics on mount
  useEffect(() => {
    let isMounted = true;

    const bootstrapAnalytics = async () => {
      await hydrateEnabled();
      if (!isMounted) return;

      initAnalytics({
        posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY || "",
        sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || "",
      });
    };

    void bootstrapAnalytics();

    return () => {
      isMounted = false;
    };
  }, []);

  // Identify user when session changes
  useEffect(() => {
    const userId = session?.user?.id;

    if (userId && userId !== prevUserIdRef.current) {
      identify(userId, {
        authProvider: session.user.app_metadata?.provider || "email",
      });
      prevUserIdRef.current = userId;
    } else if (!userId && prevUserIdRef.current) {
      // User logged out
      resetAnalytics();
      prevUserIdRef.current = undefined;
    }
  }, [session?.user?.id, session?.user?.app_metadata?.provider]);

  // Unified deep-link handling. All parsing + routing lives in
  // `apps/mobile/src/lib/deep-link.ts` so push taps, quick actions, share
  // targets, QR scans, and wallet adds all funnel through one parser.
  // TODO(deep-link.ts): the OAuth parity plan
  // (docs/plans/2026-04-26-001-feat-mobile-oauth-parity-with-web-plan.md)
  // also touches this handler — coordinate convergence on parseTeammeetUrl.
  const handleDeepLink = useCallback(async (event: { url: string }) => {
    const intent = parseTeammeetUrl(event.url);
    await routeIntent(router, intent, event.url);
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    // Check for initial URL (app opened via deep link)
    Linking.getInitialURL().then((url) => {
      if (url && isMounted) {
        handleDeepLink({ url });
      }
    });

    // Listen for deep links while app is open
    const subscription = Linking.addEventListener("url", handleDeepLink);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [handleDeepLink]);

  // Quick actions: register defaults on session, and dispatch presses through
  // the same routeIntent pipeline as deep links.
  useEffect(() => {
    if (!session) {
      void clearQuickActions();
      return;
    }
    void registerQuickActions();
    return subscribeQuickActions(router);
  }, [session, router]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const isOnCallback = segments[1] === "callback";
    const isOnResetPassword = segments[1] === "reset-password";

    // Don't redirect away from callback or reset-password screens while processing
    if (isOnCallback || isOnResetPassword) return;

    if (!session && !inAuthGroup) {
      router.replace("/(auth)");
    } else if (session && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [session, isLoading, segments, router]);

  if (!fontsLoaded || isLoading) {
    return <AuthLoadingScreen />;
  }

  const navigation = (
    <Stack>
      <Stack.Screen
        name="(auth)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="(app)"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <ToastProvider>
        <ToastBridge />
        {navigation}
      </ToastProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
