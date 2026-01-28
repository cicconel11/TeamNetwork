import { useEffect, useCallback, useRef } from "react";
import { StyleSheet, Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { supabase } from "@/lib/supabase";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AuthLoadingScreen from "@/components/AuthLoadingScreen";
import { init as initAnalytics, identify, reset as resetAnalytics, captureException, hydrateEnabled, setEnabled } from "@/lib/analytics";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useScreenTracking } from "@/hooks/useScreenTracking";

// Stripe React Native is a native module — not available on web.
// Use conditional require to avoid crash when running in browser.
const StripeProvider =
  Platform.OS !== "web"
    ? require("@stripe/stripe-react-native").StripeProvider
    : null;

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

if (!STRIPE_PUBLISHABLE_KEY && !__DEV__) {
  console.error("[Stripe] Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. Payment features will not work.");
}

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
export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutInner />
    </AuthProvider>
  );
}

function RootLayoutInner() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const { session, isLoading } = useAuth();
  const prevUserIdRef = useRef<string | undefined>(undefined);

  // Track screen views automatically
  useScreenTracking();

  // Initialize push notifications
  usePushNotifications({
    userId: session?.user?.id ?? null,
    enabled: true,
  });

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

      // Enable analytics in dev mode for testing
      // TODO: Remove this line or add a dev settings toggle
      if (__DEV__) {
        setEnabled(true);
      }
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
        email: session.user.email,
        authProvider: session.user.app_metadata?.provider || "email",
      });
      prevUserIdRef.current = userId;
    } else if (!userId && prevUserIdRef.current) {
      // User logged out
      resetAnalytics();
      prevUserIdRef.current = undefined;
    }
  }, [session?.user?.id, session?.user?.email, session?.user?.app_metadata?.provider]);

  // Handle deep link URLs that contain OAuth tokens or recovery links
  const handleDeepLink = useCallback(async (event: { url: string }) => {
    const url = event.url;

    // Validate the deep link URL hostname before processing tokens
    const supabaseHost = process.env.EXPO_PUBLIC_SUPABASE_URL
      ? new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname
      : null;
    const allowedHosts = [
      supabaseHost,
      "www.myteamnetwork.com",
      "myteamnetwork.com",
    ].filter(Boolean);

    try {
      const parsedHost = new URL(url).hostname;
      if (!allowedHosts.includes(parsedHost)) {
        return;
      }
    } catch {
      return;
    }

    // Check if this is a password recovery deep link
    if (url.includes("type=recovery") || url.includes("reset-password")) {
      try {
        const parsedUrl = new URL(url);

        // Extract tokens from hash fragment or query params
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

        // Set the session if we have tokens (needed for updateUser to work)
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }

        // Navigate to reset-password screen
        router.replace("/(auth)/reset-password");
        return;
      } catch (err) {
        console.error("Error handling recovery deep link:", err);
        captureException(err as Error, { context: "handleDeepLink-recovery", url });
      }
    }

    // Check if this is an auth callback URL with tokens or authorization code
    if (url.includes("access_token") || url.includes("callback") || url.includes("code=")) {
      try {
        const parsedUrl = new URL(url);

        // Handle OAuth errors returned as query params
        const errorParam = parsedUrl.searchParams.get("error");
        const errorDescription = parsedUrl.searchParams.get("error_description");
        if (errorParam) {
          captureException(
            new Error(errorDescription || errorParam),
            { context: "handleDeepLink-oauth-error", url }
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
              url,
            });
          }
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
        captureException(err as Error, { context: "handleDeepLink", url });
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

  if (isLoading) {
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
      {StripeProvider ? (
        <StripeProvider
          publishableKey={STRIPE_PUBLISHABLE_KEY}
          urlScheme="teammeet"
        >
          {navigation}
        </StripeProvider>
      ) : (
        navigation
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
