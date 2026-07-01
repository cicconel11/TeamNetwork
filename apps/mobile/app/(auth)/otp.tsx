import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useNavigation, useRouter } from "expo-router";
import { ChevronLeft, Mail } from "lucide-react-native";
import { Image } from "expo-image";
// The "claim"-named schemas are generic (email + 8-digit code); reused here for
// login OTP without forking. The 8-digit length is the hosted Supabase setting.
import { claimEmailSchema, claimOtpSchema } from "@teammeet/validation";
import { captureException, track } from "@/lib/analytics";
import { requestLoginCode, verifyLoginCode } from "@/lib/otp-signin";
import { Button } from "@/components/ui/Button";
import Turnstile, { type TurnstileRef } from "@/components/Turnstile";
import {
  NEUTRAL,
  RADIUS,
  SEMANTIC,
  SHADOWS,
  SPACING,
} from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const GRADIENT_START = "#134e4a";
const GRADIENT_END = "#0f172a";

type Step = "request" | "verify";

const CAPTCHA_LOAD_TIMEOUT_MS = 15_000;

export default function OtpSignInScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  const [step, setStep] = useState<Step>("request");
  const [pendingEmail, setPendingEmail] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [apiError, setApiError] = useState("");
  const [message, setMessage] = useState("");

  const turnstileRef = useRef<TurnstileRef>(null);
  const pendingEmailRef = useRef<string | null>(null);
  const captchaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCaptchaTimeout = () => {
    if (captchaTimeoutRef.current) {
      clearTimeout(captchaTimeoutRef.current);
      captchaTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearCaptchaTimeout();
    };
  }, []);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace("/(auth)/login");
    }
  };

  const handleRequestSubmit = () => {
    setEmailError("");
    setApiError("");
    setMessage("");

    const parsed = claimEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(
        parsed.error.issues[0]?.message ?? "Please enter a valid email address",
      );
      return;
    }

    pendingEmailRef.current = parsed.data.email;
    setLoading(true);
    turnstileRef.current?.show();
    clearCaptchaTimeout();
    captchaTimeoutRef.current = setTimeout(() => {
      captchaTimeoutRef.current = null;
      handleCaptchaError("captcha load timeout");
    }, CAPTCHA_LOAD_TIMEOUT_MS);
  };

  const handleCaptchaVerify = async (captchaToken: string) => {
    clearCaptchaTimeout();
    const targetEmail = pendingEmailRef.current;
    pendingEmailRef.current = null;
    if (!targetEmail) {
      setLoading(false);
      return;
    }

    try {
      // Login-only: requestLoginCode wraps signInWithOtp with
      // shouldCreateUser:false — it never provisions an account.
      const result = await requestLoginCode(targetEmail, captchaToken);

      if (result.kind === "rate-limited" || result.kind === "error") {
        setApiError(result.message);
        return;
      }

      // Enumeration-safe: "sent" is returned for both real accounts and
      // unknown emails, so the UI is identical either way.
      setPendingEmail(targetEmail);
      setStep("verify");
      setMessage(result.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCaptchaCancel = () => {
    clearCaptchaTimeout();
    pendingEmailRef.current = null;
    setLoading(false);
  };

  const handleCaptchaError = (errMessage: string) => {
    clearCaptchaTimeout();
    pendingEmailRef.current = null;
    setLoading(false);
    setApiError("Verification failed. Please try again.");
    captureException(new Error(`Turnstile: ${errMessage}`), {
      screen: "OtpSignIn",
      step: "request",
    });
  };

  const handleVerifySubmit = async () => {
    setTokenError("");
    setApiError("");
    setMessage("");

    const parsed = claimOtpSchema.safeParse({ token });
    if (!parsed.success) {
      setTokenError(
        parsed.error.issues[0]?.message ??
          "Enter the 8-digit code from your email",
      );
      return;
    }

    setLoading(true);
    try {
      const result = await verifyLoginCode(pendingEmail, parsed.data.token);

      if (result.kind !== "success") {
        setApiError(result.message);
        return;
      }

      // On success the Supabase client sets the session; the root layout
      // (session → /(app)) redirects automatically. Nothing further to do.
      track("user_logged_in", { method: "otp" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    if (!pendingEmail) return;
    setStep("request");
    setEmail(pendingEmail);
    setToken("");
    setApiError("");
    setMessage("");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={[GRADIENT_START, GRADIENT_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <SafeAreaView edges={["top"]} style={styles.gradientInner}>
          <View style={styles.gradientTopRow}>
            <Pressable
              onPress={handleBack}
              hitSlop={8}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <ChevronLeft size={24} color="#ffffff" />
            </Pressable>
            <Image
              source={require("../../assets/brand-logo.png")}
              style={styles.headerLogo}
              contentFit="contain"
              transition={0}
              cachePolicy="memory"
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <View style={styles.backButtonSpacer} />
          </View>
          <Text style={styles.gradientHeadline}>Sign in with an email code</Text>
          <Text style={styles.gradientSubhead}>
            We&apos;ll email you an 8-digit code to sign in — no password needed.
          </Text>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
          >
            {message ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{message}</Text>
              </View>
            ) : null}

            {apiError ? (
              <View style={styles.apiErrorBox}>
                <Text style={styles.apiErrorText}>{apiError}</Text>
              </View>
            ) : null}

            {step === "request" ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <View style={styles.inputContainer}>
                    <View style={styles.inputIconWrap}>
                      <Mail size={18} color={NEUTRAL.placeholder} />
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="you@example.com"
                      placeholderTextColor={NEUTRAL.placeholder}
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        setEmailError("");
                        setApiError("");
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      inputMode="email"
                      textContentType="username"
                      autoComplete="email"
                      editable={!loading}
                      accessibilityLabel="Email address"
                    />
                  </View>
                  {emailError ? (
                    <Text style={styles.errorText}>{emailError}</Text>
                  ) : null}
                </View>

                <Button
                  fullWidth
                  size="lg"
                  loading={loading}
                  onPress={handleRequestSubmit}
                  accessibilityLabel="Send code"
                >
                  Send Code
                </Button>
              </>
            ) : (
              <>
                <Text style={styles.codeHelp}>
                  Enter the 8-digit code we sent to{" "}
                  <Text style={styles.codeHelpEmail}>{pendingEmail}</Text>.
                </Text>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Verification code</Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      placeholder="00000000"
                      placeholderTextColor={NEUTRAL.placeholder}
                      value={token}
                      onChangeText={(text) => {
                        setToken(text.replace(/\D/g, "").slice(0, 8));
                        setTokenError("");
                        setApiError("");
                      }}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      editable={!loading}
                      accessibilityLabel="Verification code"
                    />
                  </View>
                  {tokenError ? (
                    <Text style={styles.errorText}>{tokenError}</Text>
                  ) : null}
                </View>

                <Button
                  fullWidth
                  size="lg"
                  loading={loading}
                  onPress={handleVerifySubmit}
                  accessibilityLabel="Verify code"
                >
                  Verify
                </Button>

                <Pressable
                  onPress={handleResend}
                  disabled={loading}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.resendButton,
                    pressed && styles.linkPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Resend code"
                >
                  <Text style={styles.resendText}>Resend code</Text>
                </Pressable>
              </>
            )}

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>Prefer a password? </Text>
              <Link href="/(auth)/login" asChild>
                <Pressable
                  hitSlop={8}
                  disabled={loading}
                  accessibilityRole="link"
                  style={({ pressed }) => [pressed && styles.linkPressed]}
                >
                  <Text style={styles.footerLink}>Sign In</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </View>
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
    backgroundColor: GRADIENT_END,
  },
  gradient: {
    width: "100%",
    minHeight: 220,
  },
  gradientInner: {
    flex: 1,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  gradientTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full,
  },
  backButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  backButtonSpacer: {
    width: 44,
  },
  headerLogo: {
    width: 150,
    height: 80,
  },
  gradientHeadline: {
    ...TYPOGRAPHY.headlineMedium,
    color: "#ffffff",
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  gradientSubhead: {
    ...TYPOGRAPHY.bodySmall,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  keyboardView: {
    flex: 1,
    marginTop: -SPACING.lg,
  },
  sheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    ...SHADOWS.xl,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  successBox: {
    backgroundColor: SEMANTIC.successLight,
    borderLeftWidth: 3,
    borderLeftColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  successText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.successDark,
  },
  apiErrorBox: {
    backgroundColor: SEMANTIC.errorLight,
    borderLeftWidth: 3,
    borderLeftColor: SEMANTIC.error,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  apiErrorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.errorDark,
  },
  fieldGroup: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.muted,
    marginBottom: SPACING.xs,
    textTransform: "none",
    letterSpacing: 0.2,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.background,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    minHeight: 56,
  },
  inputIconWrap: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    ...TYPOGRAPHY.bodyLarge,
    color: NEUTRAL.foreground,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  codeInput: {
    paddingLeft: SPACING.md,
    letterSpacing: 6,
    fontVariant: ["tabular-nums"],
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
    marginTop: SPACING.xs,
  },
  codeHelp: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    marginBottom: SPACING.lg,
  },
  codeHelpEmail: {
    color: NEUTRAL.foreground,
    fontWeight: "600",
  },
  resendButton: {
    alignSelf: "center",
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  resendText: {
    ...TYPOGRAPHY.labelSmall,
    color: SEMANTIC.success,
    fontWeight: "600",
    textTransform: "none",
    letterSpacing: 0.2,
  },
  linkPressed: {
    opacity: 0.6,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: SPACING.xl,
  },
  footerText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  footerLink: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.success,
    fontWeight: "700",
  },
});
