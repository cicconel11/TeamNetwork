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
import { Link, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/utils/alert";

// Check if running in web browser (Expo web mode)
const isWeb = Platform.OS === "web";

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    // Block sign-up in Expo Web mode to avoid email confirmation links
    // redirecting to the production website
    if (isWeb) {
      showAlert(
        "Native App Required",
        "Sign up is only available in the native mobile app. Expo Web mode is for development preview only. Please use the iOS or Android app to create an account."
      );
      return;
    }

    if (!email || !password || !confirmPassword) {
      showAlert("Error", "Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Error", "Passwords do not match");
      return;
    }

    if (password.length < 6) {
      showAlert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        showAlert("Error", error.message);
      } else {
        showAlert(
          "Check your email",
          "We sent you a confirmation link. Please check your email to verify your account.",
          () => router.replace("/(auth)/login")
        );
      }
    } catch (e) {
      showAlert("Error", (e as Error).message);
    } finally {
      setLoading(false);
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
          <Text style={styles.subtitle}>Create your account</Text>

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
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor="#999"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading && !isWeb}
            />

            {isWeb && (
              <View style={styles.webWarning}>
                <Text style={styles.webWarningText}>
                  ⚠️ Sign up requires the native mobile app. Use email/password login for existing accounts.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, (loading || isWeb) && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={loading || isWeb}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>{isWeb ? "Native App Only" : "Create Account"}</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity disabled={loading}>
                <Text style={styles.signinLink}>Sign In</Text>
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
    backgroundColor: "#007AFF",
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
  signinContainer: {
    flexDirection: "row",
    marginTop: 32,
  },
  signinText: {
    color: "#666",
    fontSize: 14,
  },
  signinLink: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  webWarning: {
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  webWarningText: {
    color: "#92400E",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
