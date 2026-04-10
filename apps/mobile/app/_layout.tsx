import { useEffect, useCallback, useRef } from "react";
import { StyleSheet, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { supabase } from "@/lib/supabase";
import { ColorSchemeProvider } from "@/contexts/ColorSchemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { setGlobalShowToast } from "@/components/ui/Toast";
import AuthLoadingScreen from "@/components/AuthLoadingScreen";
import { init as initAnalytics, identify, reset as resetAnalytics, captureException, hydrateEnabled } from "@/lib/analytics";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useScreenTracking } from "@/hooks/useScreenTracking";
import { useSupabaseAppState } from "@/hooks/useSupabaseAppState";
import { getNativeAppLinkRoute, sanitizeUrlForTelemetry } from "@/lib/url-safety";

// Prevent splash screen from auto-hiding until fonts are loaded
SplashScreen.preventAutoHideAsync();

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
          <RootLayoutInner />
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

  // Handle deep link URLs that contain OAuth tokens or recovery links
  const handleDeepLink = useCallback(async (event: { url: string }) => {
    const url = event.url;

    // Accept the app's native scheme as well as trusted web hosts before processing auth data.
    const supabaseHost = process.env.EXPO_PUBLIC_SUPABASE_URL
      ? new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname
      : null;
    const allowedHosts = [
      supabaseHost,
      "www.myteamnetwork.com",
      "myteamnetwork.com",
    ].filter(Boolean);

    try {
      const parsedUrl = new URL(url);
      const nativeRoute = getNativeAppLinkRoute(url);
      const isTrustedNativeAuthRoute = nativeRoute === "callback";
      if (!isTrustedNativeAuthRoute && !allowedHosts.includes(parsedUrl.hostname)) {
        return;
      }
    } catch {
      return;
    }

    // Check if this is an auth callback URL with tokens or authorization code
    if (url.includes("access_token") || url.includes("callback") || url.includes("code=")) {
      try {
        const parsedUrl = new URL(url);
        const nativeRoute = getNativeAppLinkRoute(url);
        const isNativeCallback = nativeRoute === "callback";

        // Handle OAuth errors returned as query params
        const errorParam = parsedUrl.searchParams.get("error");
        const errorDescription = parsedUrl.searchParams.get("error_description");
        if (errorParam) {
          captureException(
            new Error(errorDescription || errorParam),
            {
              context: "handleDeepLink-oauth-error",
              ...sanitizeUrlForTelemetry(url),
            }
          );
          return;
        }

        // PKCE flow: exchange authorization code for session
        const code = parsedUrl.searchParams.get("code");
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            captureException(new Error(exchangeError.message), {
              context: "handleDeepLink-pkce",
              ...sanitizeUrlForTelemetry(url),
            });
          }
          return;
        }

        // Do not accept raw access/refresh tokens on the custom callback scheme.
        // PKCE codes are sufficient here and avoid session fixation via arbitrary app links.
        if (isNativeCallback) {
          return;
        }

        // Legacy/implicit flow fallback: extract tokens from hash or query params
        let accessToken: string | null = null;
        let refreshToken: string | null = null;

        if (parsedUrl.hash) {
          const hashParams = new URLSearchParams(parsedUrl.hash.substring(1));
          accessToken = hashParams.get("access_token");
          refreshToken = hashParams.get("refresh_token");
        }

        if (!accessToken) {
          accessToken = parsedUrl.searchParams.get("access_token");
          refreshToken = parsedUrl.searchParams.get("refresh_token");
        }

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }
      } catch (err) {
        captureException(err as Error, {
          context: "handleDeepLink",
          ...sanitizeUrlForTelemetry(url),
        });
      }
    }
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
