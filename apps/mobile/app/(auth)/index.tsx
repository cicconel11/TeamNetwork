import { useState } from "react";
import { Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { DEMO_ORG, FEATURES } from "@teammeet/core";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingDemoCard } from "@/components/landing/LandingDemoCard";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { getWebAppUrl } from "@/lib/web-api";
import { SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { startGoogleSignIn } from "@/lib/google-sign-in";

export default function LandingScreen() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSignInPress = () => {
    router.push("/(auth)/login");
  };

  const handleCreateAccountPress = () => {
    router.push("/(auth)/signup");
  };

  const handleGooglePress = async () => {
    setGoogleLoading(true);
    try {
      await startGoogleSignIn("landing");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleTermsPress = () => {
    Linking.openURL(`${getWebAppUrl()}/terms`).catch(() => {
      // No-op: failing to open the browser shouldn't crash the auth screen.
    });
  };

  const handlePrivacyPress = () => {
    Linking.openURL(`${getWebAppUrl()}/privacy`).catch(() => {
      // No-op: failing to open the browser shouldn't crash the auth screen.
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Gradient background — inline, single use */}
      <LinearGradient
        colors={["#134e4a", "#0f172a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Decorative circles — inline, single use */}
      <View style={styles.circles} pointerEvents="none">
        <View style={styles.circleTopRight} />
        <View style={styles.circleMiddleLeft} />
        <View style={styles.circleBottomRight} />
      </View>

      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <LandingHero
            onSignIn={handleSignInPress}
            onCreateAccount={handleCreateAccountPress}
            onContinueWithGoogle={handleGooglePress}
            googleLoading={googleLoading}
          />

          <View style={styles.demoCardWrap}>
            <LandingDemoCard org={DEMO_ORG} />
          </View>

          <LandingFeatures features={FEATURES} />

          <View style={styles.footer}>
            <Pressable
              onPress={handleSignInPress}
              accessibilityRole="link"
              accessibilityLabel="Already a member? Sign in"
              hitSlop={8}
            >
              <Text style={styles.footerLink}>Already a member? Sign in</Text>
            </Pressable>

            <View style={styles.footerLegal}>
              <Pressable onPress={handleTermsPress} hitSlop={8}>
                <Text style={styles.footerLegalText}>Terms</Text>
              </Pressable>
              <Text style={styles.footerLegalDivider}>·</Text>
              <Pressable onPress={handlePrivacyPress} hitSlop={8}>
                <Text style={styles.footerLegalText}>Privacy</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },

  // Decorative circles
  circles: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  circleTopRight: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 9999,
    backgroundColor: "rgba(20, 184, 166, 0.08)",
    top: -80,
    right: -120,
  },
  circleMiddleLeft: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 9999,
    backgroundColor: "rgba(20, 184, 166, 0.08)",
    top: "25%",
    left: -100,
  },
  circleBottomRight: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 9999,
    backgroundColor: "rgba(20, 184, 166, 0.08)",
    top: "55%",
    right: -60,
  },

  // Demo card
  demoCardWrap: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },

  // Footer
  footer: {
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    gap: SPACING.md,
  },
  footerLink: {
    ...TYPOGRAPHY.bodyMedium,
    color: "rgba(255, 255, 255, 0.7)",
    textDecorationLine: "underline",
  },
  footerLegal: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  footerLegalText: {
    ...TYPOGRAPHY.bodySmall,
    color: "rgba(255, 255, 255, 0.5)",
  },
  footerLegalDivider: {
    ...TYPOGRAPHY.bodySmall,
    color: "rgba(255, 255, 255, 0.3)",
  },
});
