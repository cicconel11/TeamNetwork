import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { Link, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ChevronLeft, Mail } from "lucide-react-native";
import { Image } from "expo-image";
import {
  claimEmailSchema,
  claimOtpSchema,
  claimedOrgRowSchema,
} from "@teammeet/validation";
import {
  assertEmailConfirmed,
  consumeClaimRate,
} from "@/lib/auth/claim-guards";
import { supabase } from "@/lib/supabase";
import { validateSignupAge } from "@/lib/mobile-auth";
import {
  buildClaimSignInOptions,
  canSubmitClaim,
  type AgeGateResult,
} from "@/lib/claim-request";
import { captureException, track } from "@/lib/analytics";
import { showToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import Turnstile, { type TurnstileRef } from "@/components/Turnstile";
import { useOrganizations } from "@/hooks/useOrganizations";
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

// COMPLIANCE (COPPA / minor consent): claim.tsx's request step calls
// signInWithOtp({ shouldCreateUser: true }), which mints the auth.users row
// for a previously unregistered alumnus. There is no DB age backstop and
// signInWithOtp never touches the web /auth/callback age gate, so the age
// bracket must be collected and validated here before the account is minted.
type Step = "age_gate" | "request" | "verify";

const CAPTCHA_LOAD_TIMEOUT_MS = 15_000;

export default function ClaimAccountScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ code?: string; redirect?: string }>();
  const codeParam = typeof params.code === "string" ? params.code : undefined;
  const redirectParam =
    typeof params.redirect === "string" &&
    params.redirect.startsWith("/") &&
    !params.redirect.startsWith("//")
      ? params.redirect
      : undefined;

  const { refetch: refetchOrganizations } = useOrganizations();

  const [step, setStep] = useState<Step>("age_gate");
  const [ageGate, setAgeGate] = useState<AgeGateResult | null>(null);
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

  const buildJoinFallbackPath = (): string => {
    const search = new URLSearchParams();
    if (codeParam) search.set("code", codeParam);
    if (redirectParam) search.set("redirect", redirectParam);
    const qs = search.toString();
    return qs
      ? `/(app)/(drawer)/join-organization?${qs}`
      : `/(app)/(drawer)/join-organization`;
  };

  // Mirror signup.tsx: collect + validate age before any account can be
  // minted. Under-13 is rejected here (validateSignupAge throws) — an
  // under-13 cannot self-claim, which is the correct COPPA outcome.
  const handleAgeGateSelect = async (
    ageBracket: "under_13" | "13_17" | "18_plus",
  ) => {
    setApiError("");
    setLoading(true);
    try {
      const result = await validateSignupAge(ageBracket);
      setAgeGate(result);
      setStep("request");
    } catch (error) {
      setApiError(
        (error as Error).message || "Unable to verify age. Please try again.",
      );
    } finally {
      setLoading(false);
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
    // Compliance guard: never mint an account without validated age metadata.
    if (!canSubmitClaim(ageGate)) {
      setLoading(false);
      setApiError("Please confirm your age before claiming your account.");
      setStep("age_gate");
      return;
    }

    try {
      // Code-flow OTP avoids email-link prefetch issues (Apple Mail / link
      // scanners consuming the magic-link token before the user clicks).
      // shouldCreateUser:true mints the auth.users row, so the validated age
      // metadata is attached here (no DB/callback backstop catches it later).
      const { error } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: buildClaimSignInOptions(captchaToken, ageGate),
      });

      if (error) {
        const status = (error as { status?: number }).status;
        const code = (error as { code?: string }).code ?? "";
        if (
          status === 429 ||
          /rate.?limit/i.test(code) ||
          /rate.?limit/i.test(error.message)
        ) {
          setApiError("Too many attempts. Please wait a moment and try again.");
        } else {
          setApiError("We couldn't send a code. Please try again.");
        }
        captureException(new Error(error.message), {
          screen: "Claim",
          step: "request",
        });
        return;
      }

      // Generic copy regardless of whether the email is on file — closes
      // enumeration via differential responses.
      setPendingEmail(targetEmail);
      setStep("verify");
      setMessage(
        "If your email is on file, we sent an 8-digit code. Check your inbox.",
      );
    } catch (e) {
      captureException(e as Error, { screen: "Claim", step: "request" });
      setApiError("Something went wrong. Please try again.");
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
      screen: "Claim",
      step: "request",
    });
  };

  const navigatePostClaim = async (orgs: { slug: string }[]) => {
    await refetchOrganizations();

    // redirectParam was sanitized at parse time (parseClaimPayload + the
    // useLocalSearchParams guard above) to relative `/...` paths only, so it
    // is safe to honor on every branch when present.
    if (orgs.length === 0) {
      router.replace(buildJoinFallbackPath() as never);
      return;
    }
    if (redirectParam) {
      router.replace(redirectParam as never);
      return;
    }
    if (orgs.length === 1) {
      router.replace(`/(app)/(drawer)/${orgs[0].slug}` as never);
      return;
    }
    router.replace("/(app)/(drawer)" as never);
  };

  const handleVerifySubmit = async () => {
    setTokenError("");
    setApiError("");
    setMessage("");

    const parsed = claimOtpSchema.safeParse({ token });
    if (!parsed.success) {
      setTokenError(
        parsed.error.issues[0]?.message ?? "Enter the 8-digit code from your email",
      );
      return;
    }

    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token: parsed.data.token,
        type: "email",
      });

      if (verifyError) {
        setApiError("That code didn't work. Please try again or resend.");
        captureException(new Error(verifyError.message), {
          screen: "Claim",
          step: "verify",
        });
        return;
      }

      // Mirror web guards (apps/web/src/lib/auth/claim-flow.ts): require an
      // email_confirmed_at session and per-user rate limit before invoking
      // the RPC. Web is the source of truth; this is defense-in-depth on the
      // mobile surface.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        captureException(
          new Error(userError?.message ?? "Missing user after verifyOtp"),
          { screen: "Claim", step: "verify" },
        );
        setApiError("Could not finish claiming. Please try again.");
        return;
      }
      const sessionUser = userData.user;
      try {
        assertEmailConfirmed(sessionUser);
      } catch (err) {
        captureException(err as Error, {
          screen: "Claim",
          step: "verify",
          userId: sessionUser.id,
        });
        setApiError("Email not verified. Please try again.");
        return;
      }
      if (!consumeClaimRate(sessionUser.id)) {
        setApiError("Too many claim attempts. Please retry shortly.");
        return;
      }

      // Defense-in-depth: verifyOtp sets email_confirmed_at on success. RPC
      // claim_alumni_profiles derives identity + email from auth.uid()
      // server-side; no caller-supplied identity here.
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "claim_alumni_profiles",
      );

      if (rpcError) {
        captureException(new Error(rpcError.message), {
          screen: "Claim",
          step: "rpc",
          userId: sessionUser.id,
        });
        setApiError("Failed to claim alumni profile");
        return;
      }

      const rowParse = claimedOrgRowSchema.safeParse(rpcData ?? []);
      if (!rowParse.success) {
        captureException(
          new Error(`claim_alumni_profiles shape: ${rowParse.error.message}`),
          { screen: "Claim", step: "rpc", userId: sessionUser.id },
        );
        setApiError("Failed to claim alumni profile");
        return;
      }
      const orgs = rowParse.data.map((r) => ({ slug: r.out_slug }));
      track("alumni_account_claimed", { org_count: orgs.length });
      showToast(
        orgs.length > 0
          ? `Welcome back! Claimed ${orgs.length} organization${orgs.length === 1 ? "" : "s"}.`
          : "Account verified.",
        "success",
      );
      await navigatePostClaim(orgs);
    } catch (e) {
      captureException(e as Error, { screen: "Claim", step: "verify" });
      setApiError("Something went wrong. Please try again.");
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
          <Text style={styles.gradientHeadline}>Claim your account</Text>
          <Text style={styles.gradientSubhead}>
            Verify your email to unlock memberships your organization already
            imported for you.
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

            {step === "age_gate" ? (
              <View style={styles.ageGateBox}>
                <Text style={styles.ageGateTitle}>Confirm your age</Text>
                <Text style={styles.ageGateText}>
                  Choose the option that applies before we verify your email.
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.ageButton,
                    pressed && styles.linkPressed,
                  ]}
                  onPress={() => handleAgeGateSelect("18_plus")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am 18 or older"
                >
                  <Text style={styles.ageButtonText}>18 or older</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.ageButton,
                    pressed && styles.linkPressed,
                  ]}
                  onPress={() => handleAgeGateSelect("13_17")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am 13 to 17"
                >
                  <Text style={styles.ageButtonText}>13 to 17</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.ageButtonSecondary,
                    pressed && styles.linkPressed,
                  ]}
                  onPress={() => handleAgeGateSelect("under_13")}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="I am under 13"
                >
                  <Text style={styles.ageButtonSecondaryText}>Under 13</Text>
                </Pressable>
                {loading ? (
                  <ActivityIndicator
                    color={SEMANTIC.success}
                    style={styles.ageLoading}
                  />
                ) : null}
              </View>
            ) : step === "request" ? (
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
              <Text style={styles.footerText}>Already have an account? </Text>
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
    // No flex: 1 — see login.tsx: flexed child kept the gradient at its fixed
    // minHeight, letting the sheet overlap cover the header on tall-inset
    // devices. Content-driven height + padding clears the sheet overlap.
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.lg + SPACING.lg,
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
  ageGateBox: {
    backgroundColor: NEUTRAL.background,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  ageGateTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  ageGateText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    marginBottom: SPACING.md,
  },
  ageButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  ageButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
    fontWeight: "600",
  },
  ageButtonSecondary: {
    backgroundColor: NEUTRAL.surface,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    alignItems: "center",
  },
  ageButtonSecondaryText: {
    ...TYPOGRAPHY.labelLarge,
    color: NEUTRAL.foreground,
    fontWeight: "600",
  },
  ageLoading: {
    marginTop: SPACING.md,
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
