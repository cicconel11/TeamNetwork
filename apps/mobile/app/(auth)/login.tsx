import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";

// #region agent log
const DEBUG_ENDPOINT = "http://127.0.0.1:7242/ingest/0eaba42a-4b1e-479c-bf2c-aacdd15d55fa";
const debugLog = (location: string, message: string, data: Record<string, unknown>, hypothesisId: string) => {
  fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, message, data, hypothesisId, timestamp: Date.now(), sessionId: "debug-session" }) }).catch(() => {});
};
// #endregion

WebBrowser.maybeCompleteAuthSession();

// Determine if running in Expo Go vs dev-client/standalone
const isExpoGo = Constants.appOwnership === "expo";

export default function LoginScreen() {
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Separate loading states
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const isLoading = emailLoading || googleLoading;

  // Email/Password sign in
  const handleEmailSignIn = async () => {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email");
      return;
    }
    if (!password) {
      Alert.alert("Error", "Please enter your password");
      return;
    }

    setEmailLoading(true);
    try {
      console.log("DEBUG: Attempting email sign in for:", email.trim().toLowerCase());
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      console.log("DEBUG: signInWithPassword result:", {
        hasSession: !!data?.session,
        userId: data?.session?.user?.id,
        userEmail: data?.session?.user?.email,
        error: error?.message,
      });

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      // Verify session was persisted
      const { data: verifyData } = await supabase.auth.getSession();
      console.log("DEBUG: Verify session after login:", {
        hasSession: !!verifyData?.session,
        userId: verifyData?.session?.user?.id,
      });

      // #region agent log
      debugLog("login.tsx:handleEmailSignIn:sessionVerified", "Session verified after email login", {
        hasSession: !!verifyData?.session,
        userId: verifyData?.session?.user?.id ?? null,
        email: verifyData?.session?.user?.email ?? null,
      }, "A");
      // #endregion

      // Navigation happens automatically via _layout.tsx onAuthStateChange
    } catch (e) {
      console.error("DEBUG: Sign in exception:", e);
      // #region agent log
      debugLog("login.tsx:handleEmailSignIn:error", "Email sign in error", { error: (e as Error).message }, "A");
      // #endregion
      Alert.alert("Error", (e as Error).message);
    } finally {
      setEmailLoading(false);
    }
  };

  // Google OAuth sign in
  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    try {
      // Use different redirect URI for Expo Go vs dev-client/standalone
      // Expo Go doesn't support custom schemes, so we use the Expo-style URL
      const redirectUri = isExpoGo
        ? Linking.createURL("auth/callback") // exp://... style for Expo Go
        : makeRedirectUri({ scheme: "teammeet" }); // teammeet:// for dev builds

      console.log("DEBUG: Google OAuth starting", {
        isExpoGo,
        redirectUri,
        appOwnership: Constants.appOwnership,
      });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      console.log("DEBUG: signInWithOAuth result", {
        hasUrl: !!data?.url,
        error: error?.message,
      });

      if (error) throw error;

      if (data.url) {
        console.log("DEBUG: Opening auth session", { authUrl: data.url.slice(0, 100) + "..." });
        
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUri
        );

        console.log("DEBUG: WebBrowser result", {
          type: result.type,
          url: result.type === "success" ? result.url?.slice(0, 100) + "..." : undefined,
        });

        if (result.type === "success") {
          // Fix: OAuth tokens come in URL fragment (#), not query string (?)
          const url = new URL(result.url);
          const hashParams = new URLSearchParams(url.hash.substring(1));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          console.log("DEBUG: Parsed OAuth tokens", {
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!refreshToken,
            hashLength: url.hash.length,
          });

          if (!accessToken || !refreshToken) {
            console.error("DEBUG: OAuth callback missing tokens", {
              url: result.url,
              hash: url.hash.slice(0, 50),
            });
            throw new Error("Authentication failed: missing credentials");
          }

          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          console.log("DEBUG: setSession result", {
            error: sessionError?.message,
          });

          if (sessionError) throw sessionError;

          // Verify session persisted to AsyncStorage
          const { data: verifyData } = await supabase.auth.getSession();
          console.log("DEBUG: Verify session after OAuth", {
            hasSession: !!verifyData?.session,
            userId: verifyData?.session?.user?.id,
            email: verifyData?.session?.user?.email,
          });

          if (!verifyData.session) {
            throw new Error("Session failed to persist. Please try again.");
          }

          console.log("DEBUG: OAuth session persisted successfully", {
            userId: verifyData.session.user.id,
            email: verifyData.session.user.email,
          });

          // #region agent log
          debugLog("login.tsx:signInWithGoogle:sessionPersisted", "OAuth session persisted", {
            userId: verifyData.session.user.id,
            email: verifyData.session.user.email,
          }, "A");
          // #endregion
        } else if (result.type === "cancel") {
          console.log("DEBUG: User cancelled OAuth flow");
        } else {
          console.log("DEBUG: OAuth flow dismissed", { type: result.type });
        }
      }
    } catch (error) {
      console.error("DEBUG: Google OAuth error", error);
      Alert.alert("Error", (error as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.title}>TeamMeet</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        {/* Email/Password Form */}
        <View style={styles.form}>
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
            style={[styles.button, isLoading && styles.buttonDisabled]}
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
          style={[styles.googleButton, isLoading && styles.buttonDisabled]}
          onPress={signInWithGoogle}
          disabled={isLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          )}
        </TouchableOpacity>

        {/* Sign Up Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/signup" asChild>
            <TouchableOpacity disabled={isLoading}>
              <Text style={styles.link}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
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
  form: {
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
    backgroundColor: "#2563eb",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
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
    color: "#999",
    fontSize: 14,
  },
  googleButton: {
    backgroundColor: "#4285F4",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  googleButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    marginTop: 32,
  },
  footerText: {
    color: "#666",
    fontSize: 14,
  },
  link: {
    color: "#2563eb",
    fontSize: 14,
    fontWeight: "600",
  },
});
