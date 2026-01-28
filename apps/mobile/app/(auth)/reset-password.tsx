import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Eye, EyeOff, CheckCircle } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { borderRadius, spacing, fontSize } from "@/lib/theme";

// Color system matching login screen
const colors = {
  // Gradient header
  gradientStart: "#134e4a",
  gradientEnd: "#0f172a",

  // Backgrounds
  background: "#ffffff",
  inputBackground: "#f8fafc",
  successBackground: "#f0fdf4",

  // Text
  title: "#0f172a",
  subtitle: "#64748b",
  inputText: "#0f172a",
  placeholder: "#94a3b8",
  successText: "#166534",

  // Buttons
  primaryButton: "#059669",
  primaryButtonText: "#ffffff",

  // Input states
  inputBorder: "#e2e8f0",
  inputBorderFocus: "#059669",
  inputBorderError: "#ef4444",
  errorText: "#ef4444",

  // Links
  link: "#059669",

  // Disabled
  disabledButton: "#94a3b8",
};

export default function ResetPasswordScreen() {
  const router = useRouter();

  // Form state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Focus states
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  // Error states
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [apiError, setApiError] = useState("");

  // Loading and success states
  const [loading, setLoading] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  const isFormValid =
    password.length >= 6 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordError("");
    setApiError("");
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    setConfirmPasswordError("");
    setApiError("");
  };

  const handleUpdatePassword = async () => {
    setPasswordError("");
    setConfirmPasswordError("");
    setApiError("");

    if (!password) {
      setPasswordError("Please enter a new password");
      return;
    }
    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    if (!confirmPassword) {
      setConfirmPasswordError("Please confirm your password");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        captureException(new Error(error.message), {
          screen: "ResetPassword",
        });
        // Provide user-friendly error messages
        if (error.message.includes("same as")) {
          setApiError("New password must be different from your current password.");
        } else if (error.message.includes("weak")) {
          setApiError("Password is too weak. Please choose a stronger password.");
        } else {
          setApiError(error.message);
        }
        return;
      }

      setPasswordUpdated(true);
    } catch (e) {
      captureException(e as Error, { screen: "ResetPassword" });
      setApiError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    router.replace("/(app)");
  };

  const getInputStyle = (focused: boolean, hasError: boolean) => {
    return [
      styles.input,
      focused && !hasError && styles.inputFocused,
      hasError && styles.inputError,
    ];
  };

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={["top"]} style={styles.headerContent}>
          <View style={styles.headerSpacer} />
          <View style={styles.headerIcon}>
            <Text style={styles.headerIconText}>TN</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* White Content Area */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title */}
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.subtitle}>
            {passwordUpdated
              ? "Your password has been updated successfully."
              : "Enter your new password below."}
          </Text>

          {passwordUpdated ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconContainer}>
                <CheckCircle size={48} color={colors.successText} />
              </View>
              <Text style={styles.successTitle}>Password Updated</Text>
              <Text style={styles.successMessage}>
                You can now use your new password to sign in.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.7 }]}
                onPress={handleContinue}
                accessibilityLabel="Continue to app"
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
            </View>
          ) : (
            /* Form State */
            <View style={styles.form}>
              {/* Password Input */}
              <View style={styles.inputWrapper}>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[
                      getInputStyle(passwordFocused, !!passwordError),
                      styles.passwordInput,
                    ]}
                    placeholder="New Password"
                    placeholderTextColor={colors.placeholder}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    secureTextEntry={!showPassword}
                    editable={!loading}
                    accessibilityLabel="New password"
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                    disabled={loading}
                    accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                    accessibilityRole="button"
                  >
                    {showPassword ? (
                      <EyeOff size={20} color={colors.placeholder} />
                    ) : (
                      <Eye size={20} color={colors.placeholder} />
                    )}
                  </Pressable>
                </View>
                {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputWrapper}>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[
                      getInputStyle(confirmPasswordFocused, !!confirmPasswordError),
                      styles.passwordInput,
                    ]}
                    placeholder="Confirm New Password"
                    placeholderTextColor={colors.placeholder}
                    value={confirmPassword}
                    onChangeText={handleConfirmPasswordChange}
                    onFocus={() => setConfirmPasswordFocused(true)}
                    onBlur={() => setConfirmPasswordFocused(false)}
                    secureTextEntry={!showConfirmPassword}
                    editable={!loading}
                    accessibilityLabel="Confirm new password"
                  />
                  <Pressable
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                    disabled={loading}
                    accessibilityLabel={showConfirmPassword ? "Hide password" : "Show password"}
                    accessibilityRole="button"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={20} color={colors.placeholder} />
                    ) : (
                      <Eye size={20} color={colors.placeholder} />
                    )}
                  </Pressable>
                </View>
                {confirmPasswordError && (
                  <Text style={styles.errorText}>{confirmPasswordError}</Text>
                )}
              </View>

              {/* API Error */}
              {apiError && (
                <View style={styles.apiErrorBox}>
                  <Text style={styles.apiErrorText}>{apiError}</Text>
                </View>
              )}

              {/* Primary CTA */}
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  (!isFormValid || loading) && styles.primaryButtonDisabled,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={handleUpdatePassword}
                disabled={!isFormValid || loading}
                accessibilityLabel="Update password"
                accessibilityRole="button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryButtonText} />
                ) : (
                  <Text style={styles.primaryButtonText}>Update Password</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    paddingBottom: spacing.xs,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryButton,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "bold",
  },

  // Content
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },

  // Typography
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.title,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.base,
    color: colors.subtitle,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },

  // Form
  form: {
    width: "100%",
  },
  inputWrapper: {
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.inputText,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  inputFocused: {
    borderColor: colors.inputBorderFocus,
  },
  inputError: {
    borderColor: colors.inputBorderError,
  },
  passwordContainer: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    width: 32,
  },
  errorText: {
    color: colors.errorText,
    fontSize: fontSize.sm,
    marginTop: 4,
  },
  apiErrorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  apiErrorText: {
    color: colors.errorText,
    fontSize: fontSize.sm,
  },

  // Primary Button
  primaryButton: {
    backgroundColor: colors.primaryButton,
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.disabledButton,
  },
  primaryButtonText: {
    color: colors.primaryButtonText,
    fontSize: fontSize.base,
    fontWeight: "600",
  },

  // Success State
  successContainer: {
    alignItems: "center",
    paddingTop: spacing.lg,
  },
  successIconContainer: {
    marginBottom: spacing.lg,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.title,
    marginBottom: spacing.sm,
  },
  successMessage: {
    fontSize: fontSize.base,
    color: colors.subtitle,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
});
