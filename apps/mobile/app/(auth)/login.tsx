import { useEffect, useState } from "react";
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
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/utils/alert";

// Determine if running in Expo Go vs dev-client/standalone
const isExpoGo = Constants.appOwnership === "expo";
// Check if running in web browser (Expo web mode)
const isWeb = Platform.OS === "web";
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Conditionally import Google Sign-In only when not in Expo Go
// This prevents crashes since the native module doesn't exist in Expo Go
let GoogleSignin: any = null;
let isErrorWithCode: any = null;
let statusCodes: any = null;

if (!isExpoGo && !isWeb) {
  try {
    const googleSignIn = require("@react-native-google-signin/google-signin");
    GoogleSignin = googleSignIn.GoogleSignin;
    isErrorWithCode = googleSignIn.isErrorWithCode;
    statusCodes = googleSignIn.statusCodes;
  } catch (e) {
    console.warn("Google Sign-In module not available:", e);
  }
}

export default function LoginScreen() {
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Separate loading states
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const isLoading = emailLoading || googleLoading;

  useEffect(() => {
    if (isExpoGo || isWeb || !GoogleSignin) return;
    if (!googleWebClientId) {
      console.warn("Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID for Google Sign-In.");
      return;
    }

    GoogleSignin.configure({
      iosClientId: googleIosClientId,
      webClientId: googleWebClientId,
    });
  }, []);

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
    if (isExpoGo || isWeb || !GoogleSignin) {
      showAlert(
        isWeb ? "Web Mode Limitation" : "Expo Go Limitation",
        "Google Sign-In is not available in this mode. Please use email/password to sign in, or use the native mobile app for Google OAuth support."
      );
      return;
    }

    if (!googleWebClientId) {
      showAlert(
        "Google Sign-In Error",
        "Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID. Please add it to apps/mobile/.env.local."
      );
      return;
    }

    if (Platform.OS === "ios" && !googleIosClientId) {
      showAlert(
        "Google Sign-In Error",
        "Missing EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. Please add it to apps/mobile/.env.local."
      );
      return;
    }

    setGoogleLoading(true);
    try {
      if (Platform.OS === "android") {
        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      }

      const userInfo = await GoogleSignin.signIn();

      if (!userInfo.data?.idToken) {
        throw new Error("Google Sign-In did not return an ID token.");
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: userInfo.data.idToken,
      });

      if (error) throw error;
      // Navigation happens automatically via _layout.tsx onAuthStateChange
    } catch (error) {
      if (isErrorWithCode && statusCodes && isErrorWithCode(error)) {
        if (error.code === statusCodes.SIGN_IN_CANCELLED) {
          return;
        }
        if (error.code === statusCodes.IN_PROGRESS) {
          showAlert("Google Sign-In", "Sign-in is already in progress.");
          return;
        }
        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          showAlert(
            "Google Sign-In",
            "Google Play Services is not available on this device."
          );
          return;
        }
      }

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
