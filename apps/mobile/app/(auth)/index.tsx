import { View, Text, Pressable, StyleSheet, StatusBar, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

export default function LandingScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  const handleSignInPress = () => {
    router.push("/(auth)/login");
  };

  const handleCreateAccountPress = () => {
    router.push("/(auth)/signup");
  };

  const handleGooglePress = () => {
    router.push("/(auth)/login");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Gradient Background */}
      <LinearGradient
        colors={["#134e4a", "#0f172a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      />

      {/* Decorative Circles */}
      <View style={styles.circlesContainer}>
        <View style={[styles.circle, { width: width * 0.8, height: width * 0.8, top: -width * 0.2, right: -width * 0.3 }]} />
        <View style={[styles.circle, { width: width * 0.6, height: width * 0.6, top: height * 0.25, left: -width * 0.25 }]} />
        <View style={[styles.circle, { width: width * 0.5, height: width * 0.5, top: height * 0.5, right: -width * 0.15 }]} />
      </View>

      {/* Bottom Card */}
      <SafeAreaView style={styles.cardWrapper} edges={["bottom"]}>
        <View style={styles.card}>
          {/* Header with App Icon */}
          <View style={styles.cardHeader}>
            <View style={styles.appIcon}>
              <Text style={styles.appIconText}>TN</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {/* Title */}
          <Text style={styles.title}>Get Started</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Join your team's network or sign in to continue.
          </Text>

          {/* Primary Button: Sign In */}
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.8 }]}
            onPress={handleSignInPress}
            accessibilityLabel="Sign In"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Sign In</Text>
          </Pressable>

          {/* Secondary Button: Create Account */}
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.8 }]}
            onPress={handleCreateAccountPress}
            accessibilityLabel="Create Account"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Create Account</Text>
          </Pressable>

          {/* Tertiary Button: Continue with Google */}
          <Pressable
            style={({ pressed }) => [styles.tertiaryButton, pressed && { opacity: 0.8 }]}
            onPress={handleGooglePress}
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
          >
            <View style={styles.googleButtonContent}>
              <View style={styles.googleIcon}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <Text style={styles.tertiaryButtonText}>Continue with Google</Text>
            </View>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Decorative Circles
  circlesContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  circle: {
    position: "absolute",
    borderRadius: 9999,
    backgroundColor: "rgba(20, 184, 166, 0.08)",
  },

  // Card
  cardWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  card: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: "continuous",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    boxShadow: "0px -4px 12px rgba(0, 0, 0, 0.1)",
  },

  // Header
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  appIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderCurve: "continuous",
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
  },
  appIconText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  headerSpacer: {
    width: 44,
  },

  // Typography
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    lineHeight: 24,
    marginBottom: 28,
  },

  // Buttons
  primaryButton: {
    backgroundColor: "#059669",
    paddingVertical: 16,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#0f172a",
    paddingVertical: 16,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  tertiaryButton: {
    backgroundColor: "transparent",
    paddingVertical: 16,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#1e293b",
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
    borderColor: "#cbd5e1",
  },
  googleIconText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#4285F4",
  },
  tertiaryButtonText: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
});
