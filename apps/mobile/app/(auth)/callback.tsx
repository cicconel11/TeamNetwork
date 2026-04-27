import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { captureException } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string; error_description?: string }>();
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      router.replace("/(app)");
    }
  }, [session, router]);

  useEffect(() => {
    if (!params.error && !params.error_description) {
      return;
    }

    const message = params.error_description || params.error || "Authentication failed";
    captureException(new Error(message), { screen: "AuthCallback" });
    setError(message);

    const timeout = setTimeout(() => {
      router.replace("/(auth)/login");
    }, 2000);

    return () => clearTimeout(timeout);
  }, [params.error, params.error_description, router]);

  useEffect(() => {
    if (session || error) {
      return;
    }

    const timeout = setTimeout(() => {
      setError(
        "This sign-in link may have expired or already been used. Please try signing in again."
      );
      router.replace("/(auth)/login");
    }, 5000);

    return () => clearTimeout(timeout);
  }, [session, error, router]);

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
