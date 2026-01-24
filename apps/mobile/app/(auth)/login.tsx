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
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter, useNavigation } from "expo-router";
import { ChevronLeft, Eye, EyeOff } from "lucide-react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { borderRadius, spacing, fontSize } from "@/lib/theme";

// Determine if running in Expo Go vs dev-client/standalone
const isExpoGo = Constants.appOwnership === "expo";
// Check if running in web browser (Expo web mode)
const isWeb = Platform.OS === "web";
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Conditionally import Google Sign-In only when not in Expo Go
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

// Color system matching landing page
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
  secondaryBorder: "#1e293b",
  secondaryText: "#0f172a",

  // Input states
  inputBorder: "#e2e8f0",
  inputBorderFocus: "#059669",
  inputBorderError: "#ef4444",
  errorText: "#ef4444",

  // Links
  link: "#059669",

  // Disabled
  disabledButton: "#94a3b8",

  // Divider
  dividerLine: "#e2e8f0",
  dividerText: "#64748b",
};

// Simple email validation (no regex)
const isEmailValid = (email: string) => {
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.includes("@") && trimmed.includes(".");
};

export default function LoginScreen() {
  const router = useRouter();
  const navigation = useNavigation();

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

  // Focus states
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Error states
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [apiError, setApiError] = useState("");

  // Separate loading states
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const isLoading = emailLoading || googleLoading;
  const isFormValid = isEmailValid(email) && password.length > 0;

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

  // Dev login - bypasses auth for local development
  const handleDevLogin = async () => {
    setEmailLoading(true);
    setApiError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: "mleonard1616@gmail.com",
        password: "dev123",
      });
      if (error) {
        setApiError(error.message);
      }
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setEmailLoading(false);
    }
  };

  // Email/Password sign in
  const handleEmailSignIn = async () => {
    // Clear previous errors
    setEmailError("");
    setPasswordError("");
    setApiError("");

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
      setPasswordError("Please enter your password");
      return;
    }

    setEmailLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail.toLowerCase(),
        password,
      });

      if (error) {
        captureException(new Error(error.message), { screen: "Login", email: trimmedEmail.toLowerCase() });
        setApiError(error.message);
        return;
      }

      console.log("Sign in successful, session:", data.session?.user?.email);
      // Navigation happens automatically via _layout.tsx onAuthStateChange
    } catch (e) {
      captureException(e as Error, { screen: "Login", email: trimmedEmail.toLowerCase() });
      setApiError((e as Error).message);
    } finally {
      setEmailLoading(false);
    }
  };

  // Google OAuth sign in
  const signInWithGoogle = async () => {
    setApiError("");

    // In Expo Go or Web mode, Google OAuth has limitations
    if (isExpoGo || isWeb || !GoogleSignin) {
      setApiError(
        isWeb
          ? "Google Sign-In is not available in web mode. Please use email/password."
          : "Google Sign-In is not available in Expo Go. Please use email/password or the native app."
      );
      return;
    }

    if (!googleWebClientId) {
      setApiError("Google Sign-In is not configured. Missing client ID.");
      return;
    }

    if (Platform.OS === "ios" && !googleIosClientId) {
      setApiError("Google Sign-In is not configured for iOS. Missing client ID.");
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
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (isErrorWithCode && statusCodes && isErrorWithCode(error)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) {
          return;
        }
        if (err.code === statusCodes.IN_PROGRESS) {
          setApiError("Sign-in is already in progress.");
          return;
        }
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setApiError("Google Play Services is not available on this device.");
          return;
        }
      }
      setApiError(err.message || "An unexpected error occurred");
    } finally {
      setGoogleLoading(false);
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
          <Text style={styles.title}>Sign In</Text>
          <Text style={styles.subtitle}>
            Welcome back! Enter your credentials to continue.
          </Text>

          {/* Form */}
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
                editable={!isLoading}
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
                  editable={!isLoading}
                  accessibilityLabel="Password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  disabled={isLoading}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                  accessibilityRole="button"
                >
                  {showPassword ? (
                    <EyeOff size={20} color={colors.placeholder} />
                  ) : (
                    <Eye size={20} color={colors.placeholder} />
                  )}
                </TouchableOpacity>
              </View>
              {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
            </View>

            {/* Forgot Password Link */}
            <TouchableOpacity
              onPress={() => router.push("/(auth)/forgot-password")}
              style={styles.forgotPassword}
              disabled={isLoading}
              accessibilityRole="link"
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </TouchableOpacity>

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
                (!isFormValid || isLoading) && styles.primaryButtonDisabled,
              ]}
              onPress={handleEmailSignIn}
              disabled={!isFormValid || isLoading}
              accessibilityLabel="Sign in"
              accessibilityRole="button"
            >
              {emailLoading ? (
                <ActivityIndicator color={colors.primaryButtonText} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
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
            style={[styles.googleButton, isLoading && styles.googleButtonDisabled]}
            onPress={signInWithGoogle}
            disabled={isLoading}
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.secondaryText} />
            ) : (
              <View style={styles.googleButtonContent}>
                <View style={styles.googleIcon}>
                  <Text style={styles.googleIconText}>G</Text>
                </View>
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Sign Up Link */}
          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity disabled={isLoading} accessibilityRole="link">
                <Text style={styles.signupLink}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>

          {/* Dev Login - only in development */}
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.devButton, isLoading && styles.devButtonDisabled]}
              onPress={handleDevLogin}
              disabled={isLoading}
              accessibilityLabel="Developer login"
              accessibilityRole="button"
            >
              <Text style={styles.devButtonText}>Dev Login</Text>
            </TouchableOpacity>
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

  // Forgot Password Link
  forgotPassword: {
    alignSelf: "flex-end",
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  forgotPasswordText: {
    color: colors.link,
    fontSize: fontSize.sm,
    fontWeight: "500",
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

  // Divider
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.dividerLine,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    color: colors.dividerText,
    fontSize: fontSize.sm,
  },

  // Google Button
  googleButton: {
    backgroundColor: "transparent",
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  googleIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  googleIconText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#4285F4",
  },
  googleButtonText: {
    color: colors.subtitle,
    fontSize: fontSize.base,
    fontWeight: "500",
  },

  // Sign Up Link
  signupContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  signupText: {
    color: colors.subtitle,
    fontSize: fontSize.sm,
  },
  signupLink: {
    color: colors.link,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },

  // Dev Button
  devButton: {
    backgroundColor: "transparent",
    paddingVertical: 10,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  devButtonDisabled: {
    opacity: 0.5,
  },
  devButtonText: {
    color: colors.placeholder,
    fontSize: fontSize.xs,
    fontWeight: "500",
  },
});
