import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/utils/alert";

WebBrowser.maybeCompleteAuthSession();

// Determine if running in Expo Go vs dev-client/standalone
const isExpoGo = Constants.appOwnership === "expo";
// Check if running in web browser (Expo web mode)
const isWeb = Platform.OS === "web";

export default function LoginScreen() {
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Separate loading states
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const isLoading = emailLoading || googleLoading;

  // Dev login - bypasses auth for local development
  const handleDevLogin = async () => {
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: "mleonard1616@gmail.com",
        password: "dev123",
      });
      if (error) {
        showAlert("Dev Login Error", error.message);
      }
    } finally {
      setEmailLoading(false);
    }
  };

  // Email/Password sign in
  const handleEmailSignIn = async () => {
    console.log("Sign in attempt:", email.trim().toLowerCase());

    if (!email.trim()) {
      showAlert("Error", "Please enter your email");
      return;
    }
    if (!password) {
      showAlert("Error", "Please enter your password");
      return;
    }

    setEmailLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      console.log("Sign in result:", { data, error });

      if (error) {
        console.error("Sign in error:", error);
        showAlert("Error", error.message);
        return;
      }

      console.log("Sign in successful, session:", data.session?.user?.email);
      // Navigation happens automatically via _layout.tsx onAuthStateChange
    } catch (e) {
      console.error("Sign in exception:", e);
      showAlert("Error", (e as Error).message);
    } finally {
      setEmailLoading(false);
    }
  };

  // Google OAuth sign in
  const signInWithGoogle = async () => {
    // In Expo Go or Web mode, Google OAuth has limitations due to redirect URI restrictions
    // OAuth redirects would go to the production web app, not back to this app
    if (isExpoGo || isWeb) {
      showAlert(
        isWeb ? "Web Mode Limitation" : "Expo Go Limitation",
        "Google Sign-In is not available in this mode. Please use email/password to sign in, or use the native mobile app for Google OAuth support."
      );
      return;
    }

    setGoogleLoading(true);
    try {
      // For dev/prod builds, use the custom scheme
      const redirectUri = makeRedirectUri({
        scheme: "teammeet",
        path: "(auth)/callback"
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;

      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUri
        );

        if (result.type === "success") {
          // Extract tokens from the result URL
          const url = new URL(result.url);

          // Check hash fragment first (standard OAuth implicit flow)
          let accessToken: string | null = null;
          let refreshToken: string | null = null;

          if (url.hash) {
            const hashParams = new URLSearchParams(url.hash.substring(1));
            accessToken = hashParams.get("access_token");
            refreshToken = hashParams.get("refresh_token");
          }

          // Fall back to query params
          if (!accessToken) {
            accessToken = url.searchParams.get("access_token");
            refreshToken = url.searchParams.get("refresh_token");
          }

          if (!accessToken || !refreshToken) {
            throw new Error("Authentication failed: missing credentials");
          }

          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) throw sessionError;

          const { data: verifyData } = await supabase.auth.getSession();
          if (!verifyData.session) {
            throw new Error("Session failed to persist. Please try again.");
          }

          // Session is set, navigation will happen automatically via _layout.tsx
        } else if (result.type === "cancel") {
          // User cancelled, do nothing
        }
      }
    } catch (error) {
      showAlert("Error", (error as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View style={styles.content}>
          <Text style={styles.title}>TeamMeet</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          {/* Email/Password Form */}
          <View style={styles.formContainer}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!isLoading}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />

            <TouchableOpacity
              style={[styles.button, styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={handleEmailSignIn}
              disabled={isLoading}
            >
              {emailLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google OAuth Button */}
          <TouchableOpacity
            style={[styles.button, styles.googleButton, isLoading && styles.buttonDisabled]}
            onPress={signInWithGoogle}
            disabled={isLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Sign in with Google</Text>
            )}
          </TouchableOpacity>

          {/* Dev Login - only in development */}
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.button, styles.devButton, isLoading && styles.buttonDisabled]}
              onPress={handleDevLogin}
              disabled={isLoading}
            >
              <Text style={styles.devButtonText}>Dev Login</Text>
            </TouchableOpacity>
          )}

          {/* Sign Up Link */}
          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={styles.signupLink}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 40,
  },
  formContainer: {
    width: "100%",
    maxWidth: 340,
  },
  input: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
  },
  googleButton: {
    backgroundColor: "#4285F4",
    width: "100%",
    maxWidth: 340,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0",
  },
  dividerText: {
    marginHorizontal: 16,
    color: "#666",
    fontSize: 14,
  },
  signupContainer: {
    flexDirection: "row",
    marginTop: 32,
  },
  signupText: {
    color: "#666",
    fontSize: 14,
  },
  signupLink: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  devButton: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "#f97316",
    width: "100%",
    maxWidth: 340,
    marginTop: 16,
  },
  devButtonText: {
    color: "#f97316",
    fontSize: 14,
    fontWeight: "600",
  },
});
