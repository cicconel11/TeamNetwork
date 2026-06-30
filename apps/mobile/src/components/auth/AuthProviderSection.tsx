import { memo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import type { MobileOAuthProvider } from "@/lib/auth-redirects";
import { NEUTRAL, RADIUS, SEMANTIC, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type AuthMode = "login" | "signup";

type AuthProviderSectionProps = {
  mode: AuthMode;
  showAppleButton: boolean;
  disabled: boolean;
  appleLoading: boolean;
  providerLoading: MobileOAuthProvider | null;
  onApplePress: () => void;
  onProviderPress: (provider: MobileOAuthProvider) => void;
};

const PROVIDERS: Array<{
  provider: MobileOAuthProvider;
  label: string;
  mark: string;
  markStyle: "google" | "linkedin" | "microsoft";
}> = [
  { provider: "google", label: "Google", mark: "G", markStyle: "google" },
  { provider: "linkedin", label: "LinkedIn", mark: "in", markStyle: "linkedin" },
  { provider: "microsoft", label: "Microsoft", mark: "M", markStyle: "microsoft" },
];

function getMarkStyle(markStyle: "google" | "linkedin" | "microsoft") {
  switch (markStyle) {
    case "google":
      return styles.googleMark;
    case "linkedin":
      return styles.linkedinMark;
    case "microsoft":
      return styles.microsoftMark;
  }
}

function getMarkTextStyle(markStyle: "google" | "linkedin" | "microsoft") {
  switch (markStyle) {
    case "google":
      return styles.googleMarkText;
    case "linkedin":
      return styles.linkedinMarkText;
    case "microsoft":
      return styles.microsoftMarkText;
  }
}

function AuthProviderSection({
  mode,
  showAppleButton,
  disabled,
  appleLoading,
  providerLoading,
  onApplePress,
  onProviderPress,
}: AuthProviderSectionProps) {
  const appleButtonType =
    mode === "signup"
      ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
      : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN;
  const actionLabel = mode === "signup" ? "Sign up" : "Sign in";

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View style={styles.headingLine} />
        <Text style={styles.headingText}>Continue with</Text>
        <View style={styles.headingLine} />
      </View>

      {showAppleButton ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={appleButtonType}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={RADIUS.lg}
          onPress={onApplePress}
          pointerEvents={disabled ? "none" : "auto"}
          style={[styles.appleButton, (disabled || appleLoading) && styles.disabled]}
        />
      ) : null}

      <View style={styles.providerGrid}>
        {PROVIDERS.map(({ provider, label, mark, markStyle }) => {
          const isLoading = providerLoading === provider;
          return (
            <Pressable
              key={provider}
              onPress={() => onProviderPress(provider)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${actionLabel} with ${label}`}
              style={({ pressed }) => [
                styles.providerButton,
                pressed && !disabled && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <View style={[styles.providerMark, getMarkStyle(markStyle)]}>
                {isLoading ? (
                  <ActivityIndicator size="small" color={markStyle === "linkedin" ? "#ffffff" : SEMANTIC.success} />
                ) : (
                  <Text style={[styles.providerMarkText, getMarkTextStyle(markStyle)]}>
                    {mark}
                  </Text>
                )}
              </View>
              <Text style={styles.providerText} numberOfLines={1} adjustsFontSizeToFit>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default memo(AuthProviderSection);

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.md,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  headingLine: {
    backgroundColor: NEUTRAL.border,
    flex: 1,
    height: 1,
  },
  headingText: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.muted,
    letterSpacing: 0,
  },
  appleButton: {
    height: 52,
    width: "100%",
  },
  providerGrid: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  providerButton: {
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: SPACING.xs,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: SPACING.sm,
    ...SHADOWS.sm,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.6,
  },
  providerMark: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  googleMark: {
    backgroundColor: "#ffffff",
    borderColor: NEUTRAL.border,
  },
  linkedinMark: {
    backgroundColor: "#0a66c2",
    borderColor: "#0a66c2",
  },
  microsoftMark: {
    backgroundColor: "#ffffff",
    borderColor: NEUTRAL.border,
  },
  providerMarkText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  googleMarkText: {
    color: "#4285F4",
  },
  linkedinMarkText: {
    color: "#ffffff",
  },
  microsoftMarkText: {
    color: "#f25022",
  },
  providerText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.foreground,
    flexShrink: 1,
    letterSpacing: 0,
  },
});
