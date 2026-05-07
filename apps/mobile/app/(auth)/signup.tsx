import { useEffect, useRef, useState } from "react";
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
import { Link, useRouter, useNavigation } from "expo-router";
import { ChevronLeft, Eye, EyeOff } from "lucide-react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "@/lib/supabase";
import {
  isAppleAuthAvailable,
  isAppleAuthCanceled,
  signUpWithApple,
} from "@/lib/apple-auth";
import { captureException, track } from "@/lib/analytics";
import { borderRadius, spacing, fontSize } from "@/lib/theme";
import Turnstile, { type TurnstileRef } from "@/components/Turnstile";
import {
  buildMobileEmailSignupCallbackUrl,
  buildMobileOAuthUrl,
  parseMobileAuthCallbackUrl,
  type MobileOAuthProvider,
} from "@/lib/auth-redirects";
import { consumeMobileAuthHandoff, validateSignupAge } from "@/lib/mobile-auth";
import { getWebAppUrl } from "@/lib/web-api";

// Check if running in web browser (Expo web mode)
const isWeb = Platform.OS === "web";

// Color system matching login page
const colors = {
  // Gradient header
  gradientStart: "#134e4a",
  gradientEnd: "#0f172a",

  // Backgrounds
  background: "#ffffff",
  inputBackground: "#f8fafc",

  // Text
  title: "#0f172a",
  subtitle: "#64748b",
  inputText: "#0f172a",
  placeholder: "#94a3b8",

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

// Simple email validation (no regex)
const isEmailValid = (email: string) => {
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.includes("@") && trimmed.includes(".");
};

type SignupStep = "age_gate" | "registration";
type AgeGateData = {
  ageBracket: "13_17" | "18_plus";
  isMinor: boolean;
  token: string;
};

export default function SignupScreen() {
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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Focus states
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  // Error states
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [apiError, setApiError] = useState("");

  // Loading state
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<MobileOAuthProvider | null>(null);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [step, setStep] = useState<SignupStep>("age_gate");
  const [ageGate, setAgeGate] = useState<AgeGateData | null>(null);
  const authBusy = loading || socialLoading !== null || appleLoading;

  // Captcha
  const turnstileRef = useRef<TurnstileRef>(null);
  const pendingCredsRef = useRef<{ email: string; password: string } | null>(null);

  const isFormValid =
    isEmailValid(email) &&
    password.length >= 6 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  useEffect(() => {
    let mounted = true;

    isAppleAuthAvailable().then((available) => {
      if (mounted) {
        setAppleAvailable(available);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleAgeGateSelect = async (ageBracket: "under_13" | "13_17" | "18_plus") => {
    setApiError("");
    setLoading(true);
    try {
      const result = await validateSignupAge(ageBracket);
      setAgeGate(result);
      setStep("registration");
    } catch (error) {
      setApiError((error as Error).message || "Unable to verify age. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Clear errors on input change
  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError("");
    setApiError("");
  };

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

  const handleSignup = async () => {
    // Clear previous errors
    setEmailError("");
    setPasswordError("");
    setConfirmPasswordError("");
    setApiError("");

    // Block sign-up in Expo Web mode to avoid email confirmation links
    // redirecting to the production website
    if (isWeb) {
      setApiError(
        "Sign up is only available in the native mobile app. Expo Web mode is for development preview only."
      );
      return;
    }

    // Validate
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Please enter your email");
      return;
    }
    if (!isEmailValid(trimmedEmail)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    if (!password) {
      setPasswordError("Please enter a password");
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
    if (!ageGate) {
      setApiError("Please verify your age before creating an account.");
      setStep("age_gate");
      return;
    }

    pendingCredsRef.current = { email: trimmedEmail.toLowerCase(), password };
    setLoading(true);
    turnstileRef.current?.show();
  };

  const handleCaptchaVerify = async (captchaToken: string) => {
    const creds = pendingCredsRef.current;
    pendingCredsRef.current = null;
    if (!creds) {
      setLoading(false);
      return;
    }
    if (!ageGate) {
      setLoading(false);
      setApiError("Please verify your age before creating an account.");
      setStep("age_gate");
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email: creds.email,
        password: creds.password,
        options: {
          data: {
            age_bracket: ageGate.ageBracket,
            is_minor: ageGate.isMinor,
            age_validation_token: ageGate.token,
          },
          emailRedirectTo: buildMobileEmailSignupCallbackUrl(getWebAppUrl()),
          captchaToken,
        },
      });

      if (error) {
        // Provide more helpful error messages
        let helpfulMessage = error.message;
        if (error.message.includes("already registered")) {
          helpfulMessage = "This email is already registered. Try signing in instead.";
        }
        setApiError(helpfulMessage);
      } else {
        track("user_signed_up", { method: "email" });
        // Show success and navigate to login
        setApiError("");
        router.replace({
          pathname: "/(auth)/login",
          params: {
            message:
              "Account created! Check your email for a verification link. If you don't see it, check your spam folder.",
          },
        });
      }
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCaptchaCancel = () => {
    pendingCredsRef.current = null;
    setLoading(false);
  };

  const handleCaptchaError = () => {
    pendingCredsRef.current = null;
    setLoading(false);
    setApiError("Verification failed. Please try again.");
  };

  const handleSocialSignup = async (provider: MobileOAuthProvider) => {
    setApiError("");

    if (!ageGate) {
      setApiError("Please verify your age before continuing with a social account.");
      setStep("age_gate");
      return;
    }

    setSocialLoading(provider);
    try {
      const redirectUri = makeRedirectUri({
        scheme: "teammeet",
        path: "callback",
      });
      const authUrl = buildMobileOAuthUrl(provider, getWebAppUrl(), {
        mode: "signup",
        ageBracket: ageGate.ageBracket,
        isMinor: ageGate.isMinor,
        ageToken: ageGate.token,
      });
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === "success" && result.url) {
        const callback = parseMobileAuthCallbackUrl(result.url);
        if (callback.type === "handoff") {
          await consumeMobileAuthHandoff(callback.code);
          track("user_signed_up", { method: provider });
        } else if (callback.type === "error") {
          throw new Error(callback.message);
        }
      }
    } catch (error) {
      setApiError((error as Error).message || "Could not complete signup.");
    } finally {
      setSocialLoading(null);
    }
  };

  const handleAppleSignup = async () => {
    setApiError("");

    if (!ageGate) {
      setApiError("Please verify your age before continuing with Apple.");
      setStep("age_gate");
      return;
    }

    if (authBusy) {
      return;
    }

    setAppleLoading(true);
    try {
      await signUpWithApple(ageGate);
      track("user_signed_up", { method: "apple" });
    } catch (error) {
      if (isAppleAuthCanceled(error)) {
        return;
      }

      captureException(error as Error, { screen: "Signup", provider: "apple" });
      setApiError((error as Error).message || "Could not complete Apple signup.");
    } finally {
      setAppleLoading(false);
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
          <Pressable
            onPress={handleBack}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <ChevronLeft size={24} color="#ffffff" />
          </Pressable>
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
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Sign up to get started with TeamNetwork.
          </Text>

          {step === "age_gate" ? (
            <View style={styles.form}>
              <View style={styles.ageGateBox}>
                <Text style={styles.ageGateTitle}>Confirm your age</Text>
                <Text style={styles.ageGateText}>
                  Choose the option that applies before creating an account.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.ageButton, pressed && { opacity: 0.8 }]}
                  onPress={() => handleAgeGateSelect("18_plus")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am 18 or older"
                >
                  <Text style={styles.ageButtonText}>18 or older</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.ageButton, pressed && { opacity: 0.8 }]}
                  onPress={() => handleAgeGateSelect("13_17")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am 13 to 17"
                >
                  <Text style={styles.ageButtonText}>13 to 17</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.ageButtonSecondary, pressed && { opacity: 0.8 }]}
                  onPress={() => handleAgeGateSelect("under_13")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am under 13"
                >
                  <Text style={styles.ageButtonSecondaryText}>Under 13</Text>
                </Pressable>
                {loading && <ActivityIndicator color={colors.primaryButton} style={styles.ageLoading} />}
              </View>
              {apiError && (
                <View style={styles.apiErrorBox}>
                  <Text style={styles.apiErrorText}>{apiError}</Text>
                </View>
              )}
            </View>
          ) : (
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

            {/* Password Input */}
            <View style={styles.inputWrapper}>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    getInputStyle(passwordFocused, !!passwordError),
                    styles.passwordInput,
                  ]}
                  placeholder="Password"
                  placeholderTextColor={colors.placeholder}
                  value={password}
                  onChangeText={handlePasswordChange}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry={!showPassword}
                  editable={!loading}
                  accessibilityLabel="Password"
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
                  placeholder="Confirm Password"
                  placeholderTextColor={colors.placeholder}
                  value={confirmPassword}
                  onChangeText={handleConfirmPasswordChange}
                  onFocus={() => setConfirmPasswordFocused(true)}
                  onBlur={() => setConfirmPasswordFocused(false)}
                  secureTextEntry={!showConfirmPassword}
                  editable={!loading && !isWeb}
                  accessibilityLabel="Confirm password"
                />
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                  disabled={loading || isWeb}
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

            {/* Web Warning */}
            {isWeb && (
              <View style={styles.webWarning}>
                <Text style={styles.webWarningText}>
                  Sign up requires the native mobile app. Use email/password login for existing accounts.
                </Text>
              </View>
            )}

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
                (!isFormValid || authBusy || isWeb) && styles.primaryButtonDisabled,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleSignup}
              disabled={!isFormValid || authBusy || isWeb}
              accessibilityLabel="Create account"
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryButtonText} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isWeb ? "Native App Only" : "Create Account"}
                </Text>
              )}
            </Pressable>

            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={borderRadius.lg}
                onPress={handleAppleSignup}
                pointerEvents={authBusy || isWeb ? "none" : "auto"}
                style={[
                  styles.appleButton,
                  (authBusy || isWeb) && styles.socialButtonDisabled,
                ]}
              />
            ) : null}

            <Pressable
              onPress={() => handleSocialSignup("google")}
              disabled={authBusy || isWeb}
              style={({ pressed }) => [
                styles.socialButton,
                appleAvailable && styles.socialButtonStacked,
                (authBusy || isWeb) && styles.socialButtonDisabled,
                pressed && { opacity: 0.75 },
              ]}
              accessibilityLabel="Continue with Google"
              accessibilityRole="button"
            >
              <View style={styles.socialChip}>
                <Text style={[styles.socialChipText, styles.socialChipTextGoogle]}>G</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "google" ? "Connecting..." : "Continue with Google"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSocialSignup("linkedin")}
              disabled={authBusy || isWeb}
              style={({ pressed }) => [
                styles.socialButton,
                styles.socialButtonStacked,
                (authBusy || isWeb) && styles.socialButtonDisabled,
                pressed && { opacity: 0.75 },
              ]}
              accessibilityLabel="Continue with LinkedIn"
              accessibilityRole="button"
            >
              <View style={[styles.socialChip, styles.socialChipLinkedIn]}>
                <Text style={[styles.socialChipText, styles.socialChipTextOnDark]}>in</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "linkedin" ? "Connecting..." : "Continue with LinkedIn"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSocialSignup("microsoft")}
              disabled={authBusy || isWeb}
              style={({ pressed }) => [
                styles.socialButton,
                styles.socialButtonStacked,
                (authBusy || isWeb) && styles.socialButtonDisabled,
                pressed && { opacity: 0.75 },
              ]}
              accessibilityLabel="Continue with Microsoft"
              accessibilityRole="button"
            >
              <View style={styles.socialChip}>
                <Text style={[styles.socialChipText, styles.socialChipTextMicrosoft]}>M</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "microsoft" ? "Connecting..." : "Continue with Microsoft"}
              </Text>
            </Pressable>
          </View>
          )}

          {/* Sign In Link */}
          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable disabled={loading} accessibilityRole="link" style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
                <Text style={styles.signinLink}>Sign In</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Turnstile
        ref={turnstileRef}
        onVerify={handleCaptchaVerify}
        onError={handleCaptchaError}
        onCancel={handleCaptchaCancel}
      />
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
  ageGateBox: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.inputBorder,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  ageGateTitle: {
    color: colors.title,
    fontSize: fontSize.lg,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  ageGateText: {
    color: colors.subtitle,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  ageButton: {
    backgroundColor: colors.primaryButton,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  ageButtonText: {
    color: "#ffffff",
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  ageButtonSecondary: {
    backgroundColor: "#ffffff",
    borderColor: colors.inputBorder,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  ageButtonSecondaryText: {
    color: colors.title,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  ageLoading: {
    marginTop: spacing.md,
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
  webWarning: {
    backgroundColor: "#FEF3C7",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  webWarningText: {
    color: "#92400E",
    fontSize: fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
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
  appleButton: {
    height: 52,
    marginTop: spacing.md,
    width: "100%",
  },
  socialButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: colors.inputBorder,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  socialButtonStacked: {
    marginTop: spacing.sm,
  },
  socialButtonDisabled: {
    opacity: 0.6,
  },
  socialChip: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderColor: colors.inputBorder,
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 24,
  },
  socialChipLinkedIn: {
    backgroundColor: "#0a66c2",
    borderColor: "#0a66c2",
  },
  socialChipText: {
    fontSize: 14,
    fontWeight: "700",
  },
  socialChipTextGoogle: {
    color: "#4285F4",
  },
  socialChipTextOnDark: {
    color: "#ffffff",
  },
  socialChipTextMicrosoft: {
    color: "#f25022",
  },
  socialText: {
    color: colors.title,
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
});
