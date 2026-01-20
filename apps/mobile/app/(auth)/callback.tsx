import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      // Get the current URL to extract tokens
      const url = await Linking.getInitialURL();
      
      if (url) {
        await processAuthUrl(url);
      } else if (params.access_token && params.refresh_token) {
        // Tokens might be passed as query params
        await setSessionFromTokens(
          params.access_token as string,
          params.refresh_token as string
        );
      } else {
        // No tokens found, redirect to login
        router.replace("/(auth)/login");
      }
    } catch (err) {
      console.error("Auth callback error:", err);
      captureException(err as Error, { screen: "AuthCallback" });
      setError((err as Error).message);
      // Wait a moment then redirect to login
      setTimeout(() => {
        router.replace("/(auth)/login");
      }, 2000);
    }
  };

  const processAuthUrl = async (url: string) => {
    // Parse the URL to extract tokens from hash fragment
    const parsedUrl = new URL(url);
    
    // Tokens can be in hash fragment (after #) or query params
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    // Check hash fragment first (standard OAuth flow)
    if (parsedUrl.hash) {
      const hashParams = new URLSearchParams(parsedUrl.hash.substring(1));
      accessToken = hashParams.get("access_token");
      refreshToken = hashParams.get("refresh_token");
    }

    // Fall back to query params
    if (!accessToken) {
      accessToken = parsedUrl.searchParams.get("access_token");
      refreshToken = parsedUrl.searchParams.get("refresh_token");
    }

    if (accessToken && refreshToken) {
      await setSessionFromTokens(accessToken, refreshToken);
    } else {
      // Check for error in URL
      const errorDescription = 
        parsedUrl.searchParams.get("error_description") ||
        new URLSearchParams(parsedUrl.hash?.substring(1) || "").get("error_description");
      
      if (errorDescription) {
        throw new Error(errorDescription);
      }
      
      throw new Error("No authentication tokens found in callback URL");
    }
  };

  const setSessionFromTokens = async (accessToken: string, refreshToken: string) => {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      throw sessionError;
    }

    // Verify session was set
    const { data: sessionData } = await supabase.auth.getSession();
    
    if (!sessionData.session) {
      throw new Error("Failed to establish session");
    }

    // Success! Navigate to app
    router.replace("/(app)");
  };

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Authentication Error</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <Text style={styles.redirectText}>Redirecting to login...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.text}>Completing sign in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 24,
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#dc2626",
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  redirectText: {
    fontSize: 14,
    color: "#999",
  },
});
