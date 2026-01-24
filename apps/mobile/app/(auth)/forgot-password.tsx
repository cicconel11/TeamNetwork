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
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter, useNavigation } from "expo-router";
import { ChevronLeft, CheckCircle } from "lucide-react-native";
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

// Simple email validation
const isEmailValid = (email: string) => {
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.includes("@") && trimmed.includes(".");
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace("/(auth)/login");
    }
  };

  // Form state
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const isFormValid = isEmailValid(email);

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError("");
    setApiError("");
  };

  const handleResetPassword = async () => {
    setEmailError("");
    setApiError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Please enter your email");
      return;
    }
    if (!isEmailValid(trimmedEmail)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail.toLowerCase()
      );

      if (error) {
        captureException(new Error(error.message), {
          screen: "ForgotPassword",
          email: trimmedEmail.toLowerCase(),
        });
        // Provide user-friendly error messages
        if (error.message.includes("rate limit")) {
          setApiError("Too many requests. Please wait a few minutes and try again.");
        } else if (error.message.includes("not found") || error.message.includes("Invalid")) {
          // Don't reveal if email exists for security
          setEmailSent(true);
        } else {
          setApiError(error.message);
        }
        return;
      }

      setEmailSent(true);
    } catch (e) {
      captureException(e as Error, {
        screen: "ForgotPassword",
        email: trimmedEmail.toLowerCase(),
      });
      setApiError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <ChevronLeft size={24} color="#ffffff" />
          </TouchableOpacity>
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
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your email and we'll send you a reset link.
          </Text>

          {emailSent ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconContainer}>
                <CheckCircle size={48} color={colors.successText} />
              </View>
              <Text style={styles.successTitle}>Check your email</Text>
              <Text style={styles.successMessage}>
                {"We've sent a password reset link to "}
                <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
              </Text>
              <Text style={styles.successHint}>
                {"If you don't see the email, check your spam folder. The link will let you set a new password."}
              </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity
                  style={styles.primaryButton}
                  accessibilityLabel="Return to sign in"
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Return to Sign In</Text>
                </TouchableOpacity>
              </Link>
            </View>
          ) : (
            /* Form State */
            <View style={styles.form}>
              {/* Email Input */}
              <View style={styles.inputWrapper}>
                <TextInput
                  style={getInputStyle(emailFocused, !!emailError)}
                  placeholder="Email"
                  placeholderTextColor={colors.placeholder}
                  value={email}
                  onChangeText={handleEmailChange}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!loading}
                  accessibilityLabel="Email address"
                />
                {emailError && <Text style={styles.errorText}>{emailError}</Text>}
              </View>

              {/* API Error */}
              {apiError && (
                <View style={styles.apiErrorBox}>
                  <Text style={styles.apiErrorText}>{apiError}</Text>
                </View>
              )}

              {/* Primary CTA */}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (!isFormValid || loading) && styles.primaryButtonDisabled,
                ]}
                onPress={handleResetPassword}
                disabled={!isFormValid || loading}
                accessibilityLabel="Send reset link"
                accessibilityRole="button"
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryButtonText} />
                ) : (
                  <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                )}
              </TouchableOpacity>

              {/* Back to Sign In Link */}
              <View style={styles.signinContainer}>
                <Text style={styles.signinText}>Remember your password? </Text>
                <Link href="/(auth)/login" asChild>
                  <TouchableOpacity disabled={loading} accessibilityRole="link">
                    <Text style={styles.signinLink}>Sign In</Text>
                  </TouchableOpacity>
                </Link>
              </View>
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
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
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

  // Sign In Link
  signinContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  signinText: {
    color: colors.subtitle,
    fontSize: fontSize.sm,
  },
  signinLink: {
    color: colors.link,
    fontSize: fontSize.sm,
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
    marginBottom: spacing.xs,
  },
  successEmail: {
    fontWeight: "600",
    color: colors.title,
  },
  successHint: {
    fontSize: fontSize.sm,
    color: colors.placeholder,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
});
