/**
 * LandingHero
 *
 * Pill badge → animated brand wordmark → tagline → sub-copy → primary CTA
 * (Sign In) → secondary CTA (Create Account, white-outlined) → custom Google
 * row → scroll hint chevron.
 *
 * Stays in a single component so the entrance animation wiring lives next to
 * the elements it animates.
 */

import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { ChevronDown } from "lucide-react-native";
import { BRAND_TAGLINE, HERO_SUB_COPY } from "@teammeet/core";
import { Button } from "@/components/ui/Button";
import { ENERGY, RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface LandingHeroProps {
  onSignIn: () => void;
  onCreateAccount: () => void;
  onContinueWithGoogle: () => void;
  googleLoading?: boolean;
}

export function LandingHero({
  onSignIn,
  onCreateAccount,
  onContinueWithGoogle,
  googleLoading = false,
}: LandingHeroProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 375;
  const logoSize = isCompact
    ? { width: 150, height: 100 }
    : { width: 220, height: 147 };

  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translate]);

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity, transform: [{ translateY: translate }] },
      ]}
    >
      {/* Pill badge — built inline, not via Badge (Badge can't render
          a separately-colored dot on a translucent surface). */}
      <View
        style={styles.pill}
        accessibilityRole="text"
        accessibilityLabel={BRAND_TAGLINE}
      >
        <View style={styles.pillDot} />
        <Text style={styles.pillText}>{BRAND_TAGLINE}</Text>
      </View>

      {/* Brand wordmark */}
      <Image
        source={require("../../../assets/brand-logo.png")}
        style={[styles.logo, logoSize]}
        contentFit="contain"
        transition={0}
        cachePolicy="memory"
        accessibilityLabel="TeamNetwork"
        accessibilityRole="image"
      />

      {/* Tagline */}
      <Text style={styles.tagline}>
        Your team&apos;s home field advantage
      </Text>

      {/* Sub-copy */}
      <Text style={styles.subCopy}>{HERO_SUB_COPY}</Text>

      {/* Primary CTA — Sign In (matches existing routing) */}
      <View style={styles.ctaWrap}>
        <Button
          fullWidth
          size="lg"
          onPress={onSignIn}
          disabled={googleLoading}
          accessibilityLabel="Sign in"
          accessibilityHint="Navigates to the sign-in screen"
        >
          Sign In
        </Button>
      </View>

      {/* Secondary CTA — Create Account.
          Outline variant defaults to emerald — must override to white. */}
      <View style={styles.ctaWrap}>
        <Button
          fullWidth
          size="lg"
          variant="outline"
          primaryColor="#ffffff"
          primaryForeground="#0f172a"
          onPress={onCreateAccount}
          disabled={googleLoading}
          accessibilityLabel="Create account"
          accessibilityHint="Navigates to the sign-up screen"
        >
          Create Account
        </Button>
      </View>

      {/* Tertiary — Continue with Google. Custom Pressable so we can show
          the colored G chip; Button has no sub-icon slot for it. */}
      <Pressable
        onPress={onContinueWithGoogle}
        disabled={googleLoading}
        style={({ pressed }) => [
          styles.googleRow,
          googleLoading && styles.googleRowDisabled,
          pressed && !googleLoading && styles.googleRowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ disabled: googleLoading, busy: googleLoading }}
      >
        <View style={styles.googleChip}>
          <Text style={styles.googleChipText}>G</Text>
        </View>
        <Text style={styles.googleText}>{googleLoading ? "Connecting…" : "Continue with Google"}</Text>
      </Pressable>

      {/* Scroll hint */}
      <View
        style={styles.scrollHint}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <ChevronDown size={20} color="rgba(255, 255, 255, 0.4)" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },

  // Pill
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    marginBottom: SPACING.md,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ENERGY.online,
  },
  pillText: {
    ...TYPOGRAPHY.labelMedium,
    color: "rgba(255, 255, 255, 0.85)",
    letterSpacing: 0.2,
    textTransform: "none",
  },

  // Logo
  logo: {
    marginBottom: SPACING.md,
  },

  // Typography
  tagline: {
    ...TYPOGRAPHY.displayMedium,
    color: "#ffffff",
    textAlign: "center",
    marginBottom: SPACING.sm + 4,
    paddingHorizontal: SPACING.sm,
  },
  subCopy: {
    ...TYPOGRAPHY.bodyLarge,
    color: "rgba(255, 255, 255, 0.7)",
    textAlign: "center",
    marginBottom: SPACING.lg,
    maxWidth: 380,
  },

  // CTAs
  ctaWrap: {
    width: "100%",
    marginBottom: SPACING.sm + 4,
  },

  // Google
  googleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm + 2,
    width: "100%",
    minHeight: 52,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    backgroundColor: "transparent",
  },
  googleRowPressed: {
    opacity: 0.7,
  },
  googleRowDisabled: {
    opacity: 0.7,
  },
  googleChip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  googleChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#4285F4",
  },
  googleText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
    fontSize: 16,
  },

  // Scroll hint
  scrollHint: {
    marginTop: SPACING.lg,
    alignItems: "center",
  },
});
