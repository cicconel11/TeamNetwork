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
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { CheckCircle, ChevronLeft, Eye, EyeOff, Lock, Mail } from "lucide-react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { Image } from "expo-image";
import { baseSchemas } from "@teammeet/validation";
import { supabase } from "@/lib/supabase";
import {
  buildMobileOAuthUrl,
  parseMobileAuthCallbackUrl,
  type MobileOAuthProvider,
} from "@/lib/auth-redirects";
import { consumeMobileAuthHandoff } from "@/lib/mobile-auth";
import { getWebAppUrl } from "@/lib/web-api";
import {
  isAppleAuthAvailable,
  isAppleAuthCanceled,
  signInWithApple,
} from "@/lib/apple-auth";
import { captureException, track } from "@/lib/analytics";
import { showToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import Turnstile, { type TurnstileRef } from "@/components/Turnstile";
import {
  ANIMATION,
  NEUTRAL,
  RADIUS,
  SEMANTIC,
  SHADOWS,
  SPACING,
} from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const GRADIENT_START = "#134e4a";
const GRADIENT_END = "#0f172a";

const isEmailValid = (email: string) => baseSchemas.email.safeParse(email).success;

export default function LoginScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ message?: string }>();
  const { width } = useWindowDimensions();
  const isCompact = width < 375;

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace("/(auth)");
    }
  };

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Focus + error state
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [apiError, setApiError] = useState("");

  // Loading state
  const [emailLoading, setEmailLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<MobileOAuthProvider | null>(null);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const isLoading = emailLoading || socialLoading !== null || appleLoading;

  // Captcha
  const turnstileRef = useRef<TurnstileRef>(null);
  const pendingCredsRef = useRef<{ email: string; password: string } | null>(null);

  // Reanimated — sheet entrance
  const sheetTranslate = useSharedValue(16);
  const sheetOpacity = useSharedValue(0);

  // Reanimated — focus border overlays
  const emailFocusOpacity = useSharedValue(0);
  const passwordFocusOpacity = useSharedValue(0);

  // Reanimated — error shake offsets
  const emailShake = useSharedValue(0);
  const passwordShake = useSharedValue(0);

  useEffect(() => {
    sheetTranslate.value = withTiming(0, {
      duration: ANIMATION.normal,
      easing: Easing.out(Easing.quad),
    });
    sheetOpacity.value = withTiming(1, {
      duration: ANIMATION.normal,
      easing: Easing.out(Easing.quad),
    });
  }, [sheetOpacity, sheetTranslate]);

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

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslate.value }],
    opacity: sheetOpacity.value,
  }));

  const emailFocusStyle = useAnimatedStyle(() => ({
    opacity: emailFocusOpacity.value,
  }));
  const passwordFocusStyle = useAnimatedStyle(() => ({
    opacity: passwordFocusOpacity.value,
  }));

  const emailShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: emailShake.value }],
  }));
  const passwordShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: passwordShake.value }],
  }));

  const runShake = (sv: typeof emailShake) => {
    sv.value = withSequence(
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(-4, { duration: 50 }),
      withTiming(4, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  };

  // Field handlers
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

  const handleEmailFocus = () => {
    setEmailFocused(true);
    emailFocusOpacity.value = withTiming(1, { duration: ANIMATION.fast });
  };
  const handleEmailBlur = () => {
    setEmailFocused(false);
    emailFocusOpacity.value = withTiming(0, { duration: ANIMATION.fast });
  };

  const handlePasswordFocus = () => {
    setPasswordFocused(true);
    passwordFocusOpacity.value = withTiming(1, { duration: ANIMATION.fast });
  };
  const handlePasswordBlur = () => {
    setPasswordFocused(false);
    passwordFocusOpacity.value = withTiming(0, { duration: ANIMATION.fast });
  };

  // Email/Password sign in — step 1: validate form, then trigger captcha
  const handleEmailSignIn = () => {
    setEmailError("");
    setPasswordError("");
    setApiError("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Please enter your email");
      runShake(emailShake);
      return;
    }
    if (!isEmailValid(trimmedEmail)) {
      setEmailError("Please enter a valid email address");
      runShake(emailShake);
      return;
    }
    if (!password) {
      setPasswordError("Please enter your password");
      runShake(passwordShake);
      return;
    }

    pendingCredsRef.current = { email: trimmedEmail.toLowerCase(), password };
    setEmailLoading(true);
    turnstileRef.current?.show();
  };

  // Email/Password sign in — step 2: captcha verified, send to Supabase
  const handleCaptchaVerify = async (captchaToken: string) => {
    const creds = pendingCredsRef.current;
    pendingCredsRef.current = null;
    if (!creds) {
      setEmailLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: creds.email,
        password: creds.password,
        options: { captchaToken },
      });

      if (error) {
        captureException(new Error(error.message), { screen: "Login", method: "email" });
        let helpfulMessage = error.message;
        if (error.message === "Invalid login credentials") {
          helpfulMessage =
            "Invalid email or password. Please check your credentials and try again.";
        } else if (error.message === "Email not confirmed") {
          helpfulMessage =
            "Please check your email and click the confirmation link before signing in.";
        }
        setApiError(helpfulMessage);
        showToast(helpfulMessage, "error");
        return;
      }

      track("user_logged_in", { method: "email" });
      // Navigation happens automatically via _layout.tsx onAuthStateChange
    } catch (e) {
      captureException(e as Error, { screen: "Login", method: "email" });
      const message = (e as Error).message || "An error occurred";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCaptchaCancel = () => {
    pendingCredsRef.current = null;
    setEmailLoading(false);
  };

  const handleCaptchaError = (message: string) => {
    pendingCredsRef.current = null;
    setEmailLoading(false);
    const helpful = "Verification failed. Please try again.";
    setApiError(helpful);
    showToast(helpful, "error");
    captureException(new Error(`Turnstile: ${message}`), { screen: "Login", method: "email" });
  };

  // Web-based OAuth sign in. All providers go through the web handoff route —
  // native social SDKs have nonce/PKCE conflicts with Supabase.
  const signInWithProvider = async (provider: MobileOAuthProvider) => {
    setApiError("");
    setSocialLoading(provider);

    try {
      const redirectUri = makeRedirectUri({
        scheme: "teammeet",
        path: "callback",
      });

      const authUrl = buildMobileOAuthUrl(provider, getWebAppUrl(), { mode: "login" });

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === "success" && result.url) {
        const callback = parseMobileAuthCallbackUrl(result.url);
        if (callback.type === "handoff") {
          await consumeMobileAuthHandoff(callback.code);
          track("user_logged_in", { method: provider });
        } else if (callback.type === "error") {
          throw new Error(callback.message);
        }
      }
      // result.type === "cancel" — silent no-op
    } catch (error: unknown) {
      const err = error as { message?: string };
      captureException(error as Error, { screen: "Login", provider });
      const message = err.message || "An unexpected error occurred";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setSocialLoading(null);
    }
  };

  const handleAppleSignIn = async () => {
    if (isLoading) {
      return;
    }

    setApiError("");
    setAppleLoading(true);

    try {
      await signInWithApple();
      track("user_logged_in", { method: "apple" });
    } catch (error: unknown) {
      if (isAppleAuthCanceled(error)) {
        return;
      }

      const err = error as { message?: string };
      captureException(error as Error, { screen: "Login", provider: "apple" });
      const message = err.message || "Could not complete Apple sign in.";
      setApiError(message);
      showToast(message, "error");
    } finally {
      setAppleLoading(false);
    }
  };

  const heroHeight = isCompact ? 170 : 220;
  const logoSize = isCompact
    ? { width: 150, height: 100 }
    : { width: 180, height: 120 };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Gradient header */}
      <LinearGradient
        colors={[GRADIENT_START, GRADIENT_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, { minHeight: heroHeight }]}
      >
        <SafeAreaView edges={["top"]} style={styles.gradientInner}>
          <View style={styles.gradientTopRow}>
            <Pressable
              onPress={handleBack}
              hitSlop={8}
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <ChevronLeft size={24} color="#ffffff" />
            </Pressable>
            <Image
              source={require("../../assets/brand-logo.png")}
              style={[styles.headerLogo, logoSize]}
              contentFit="contain"
              transition={0}
              cachePolicy="memory"
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <View style={styles.backButtonSpacer} />
          </View>
          <Text style={styles.gradientSubhead}>Sign in to your account</Text>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
          >
            {/* Success message from signup */}
            {params.message && (
              <View style={styles.successBox}>
                <CheckCircle size={20} color={SEMANTIC.successDark} />
                <Text style={styles.successText}>{params.message}</Text>
              </View>
            )}

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <Animated.View style={[styles.inputContainer, emailShakeStyle]}>
                <View style={styles.inputIconWrap}>
                  <Mail
                    size={18}
                    color={emailFocused ? NEUTRAL.muted : NEUTRAL.placeholder}
                  />
                </View>
                <TextInput
                  style={[styles.input, !!emailError && styles.inputError]}
                  placeholder="you@example.com"
                  placeholderTextColor={NEUTRAL.placeholder}
                  value={email}
                  onChangeText={handleEmailChange}
                  onFocus={handleEmailFocus}
                  onBlur={handleEmailBlur}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  inputMode="email"
                  textContentType="username"
                  autoComplete="email"
                  editable={!isLoading}
                  accessibilityLabel="Email address"
                />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.focusBorder,
                    !!emailError && styles.focusBorderError,
                    emailFocusStyle,
                  ]}
                />
              </Animated.View>
              {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <Animated.View style={[styles.inputContainer, passwordShakeStyle]}>
                <View style={styles.inputIconWrap}>
                  <Lock
                    size={18}
                    color={passwordFocused ? NEUTRAL.muted : NEUTRAL.placeholder}
                  />
                </View>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputPassword,
                    !!passwordError && styles.inputError,
                  ]}
                  placeholder="••••••••"
                  placeholderTextColor={NEUTRAL.placeholder}
                  value={password}
                  onChangeText={handlePasswordChange}
                  onFocus={handlePasswordFocus}
                  onBlur={handlePasswordBlur}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  autoComplete="current-password"
                  editable={!isLoading}
                  accessibilityLabel="Password"
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.eyeButton, pressed && styles.eyeButtonPressed]}
                  disabled={isLoading}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                  accessibilityRole="button"
                >
                  {showPassword ? (
                    <EyeOff size={20} color={NEUTRAL.placeholder} />
                  ) : (
                    <Eye size={20} color={NEUTRAL.placeholder} />
                  )}
                </Pressable>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.focusBorder,
                    !!passwordError && styles.focusBorderError,
                    passwordFocusStyle,
                  ]}
                />
              </Animated.View>
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
            </View>

            {/* Forgot password */}
            <View style={styles.forgotRow}>
              <Pressable
                onPress={() => router.push("/(auth)/forgot-password")}
                hitSlop={8}
                style={({ pressed }) => [styles.forgotPressable, pressed && styles.linkPressed]}
                disabled={isLoading}
                accessibilityRole="link"
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            </View>

            {/* API error */}
            {apiError ? (
              <View style={styles.apiErrorBox}>
                <Text style={styles.apiErrorText}>{apiError}</Text>
              </View>
            ) : null}

            {/* Primary CTA — always enabled, validates on press */}
            <Button
              fullWidth
              size="lg"
              loading={emailLoading}
              onPress={handleEmailSignIn}
              accessibilityLabel="Sign in"
              accessibilityHint="Submits your credentials and signs you in"
            >
              Sign In
            </Button>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Apple */}
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={RADIUS.lg}
                onPress={handleAppleSignIn}
                pointerEvents={isLoading ? "none" : "auto"}
                style={[
                  styles.appleButton,
                  isLoading && styles.socialButtonDisabled,
                ]}
              />
            ) : null}

            {/* Google */}
            <Pressable
              onPress={() => signInWithProvider("google")}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.socialButton,
                appleAvailable && styles.socialButtonStacked,
                isLoading && styles.socialButtonDisabled,
                pressed && styles.socialButtonPressed,
              ]}
              accessibilityLabel="Continue with Google"
              accessibilityRole="button"
            >
              <View style={styles.socialChip}>
                <Text style={[styles.socialChipText, styles.socialChipTextGoogle]}>G</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "google" ? "Connecting…" : "Continue with Google"}
              </Text>
            </Pressable>

            {/* LinkedIn */}
            <Pressable
              onPress={() => signInWithProvider("linkedin")}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.socialButton,
                styles.socialButtonStacked,
                isLoading && styles.socialButtonDisabled,
                pressed && styles.socialButtonPressed,
              ]}
              accessibilityLabel="Continue with LinkedIn"
              accessibilityRole="button"
            >
              <View style={[styles.socialChip, styles.socialChipLinkedIn]}>
                <Text style={[styles.socialChipText, styles.socialChipTextOnDark]}>in</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "linkedin" ? "Connecting…" : "Continue with LinkedIn"}
              </Text>
            </Pressable>

            {/* Microsoft */}
            <Pressable
              onPress={() => signInWithProvider("microsoft")}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.socialButton,
                styles.socialButtonStacked,
                isLoading && styles.socialButtonDisabled,
                pressed && styles.socialButtonPressed,
              ]}
              accessibilityLabel="Continue with Microsoft"
              accessibilityRole="button"
            >
              <View style={styles.socialChip}>
                <Text style={[styles.socialChipText, styles.socialChipTextMicrosoft]}>M</Text>
              </View>
              <Text style={styles.socialText}>
                {socialLoading === "microsoft" ? "Connecting…" : "Continue with Microsoft"}
              </Text>
            </Pressable>

            {/* Sign up footer */}
            <View style={styles.signupRow}>
              <Text style={styles.signupText}>Don&apos;t have an account? </Text>
              <Link href="/(auth)/signup" asChild>
                <Pressable
                  hitSlop={8}
                  disabled={isLoading}
                  accessibilityRole="link"
                  style={({ pressed }) => [pressed && styles.linkPressed]}
                >
                  <Text style={styles.signupLink}>Sign Up</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </Animated.View>
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

const FOCUS_BORDER_WIDTH = 1.5;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GRADIENT_END,
  },

  // Gradient header
  gradient: {
    width: "100%",
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
    // width/height set inline based on screen size
  },
  gradientSubhead: {
    ...TYPOGRAPHY.bodyMedium,
    color: "rgba(255, 255, 255, 0.65)",
    textAlign: "center",
    marginTop: SPACING.sm,
  },

  // Keyboard + sheet
  keyboardView: {
    flex: 1,
    marginTop: -SPACING.lg, // overlap the gradient so the curve sits on it
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

  // Success
  successBox: {
    backgroundColor: SEMANTIC.successLight,
    borderLeftWidth: 3,
    borderLeftColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  successText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.successDark,
    flex: 1,
  },

  // Form fields
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
    position: "relative",
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
    paddingRight: SPACING.md,
  },
  inputPassword: {
    paddingRight: 48,
  },
  inputError: {
    color: NEUTRAL.foreground,
  },
  focusBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: FOCUS_BORDER_WIDTH,
    borderColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
  },
  focusBorderError: {
    borderColor: SEMANTIC.error,
  },
  eyeButton: {
    position: "absolute",
    right: 4,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeButtonPressed: {
    opacity: 0.6,
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
    marginTop: SPACING.xs,
  },

  // Forgot password
  forgotRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
  },
  forgotPressable: {
    paddingVertical: SPACING.sm,
  },
  forgotText: {
    ...TYPOGRAPHY.labelSmall,
    color: SEMANTIC.success,
    fontWeight: "600",
    textTransform: "none",
    letterSpacing: 0.2,
  },
  linkPressed: {
    opacity: 0.6,
  },

  // API error box
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

  // Divider
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: SPACING.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: NEUTRAL.border,
  },
  dividerText: {
    ...TYPOGRAPHY.caption,
    marginHorizontal: SPACING.md,
    color: NEUTRAL.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // Social sign-in buttons
  appleButton: {
    width: "100%",
    height: 56,
  },
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm + 2,
    minHeight: 56,
    paddingVertical: SPACING.md,
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    ...SHADOWS.sm,
  },
  socialButtonStacked: {
    marginTop: SPACING.sm,
  },
  socialButtonDisabled: {
    opacity: 0.6,
  },
  socialButtonPressed: {
    opacity: 0.85,
  },
  socialChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
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
    ...TYPOGRAPHY.labelLarge,
    fontSize: 16,
    color: NEUTRAL.foreground,
  },

  // Sign up footer
  signupRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: SPACING.xl,
  },
  signupText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  signupLink: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.success,
    fontWeight: "700",
  },
});
