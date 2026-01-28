import { View, Text, Pressable, StyleSheet, StatusBar, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

const { width, height } = Dimensions.get("window");

export default function LandingScreen() {
  const router = useRouter();

  const handleEmailPress = () => {
    router.push("/(auth)/login");
  };

  const handleGooglePress = () => {
    router.push("/(auth)/login");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Gradient Background - dark teal to navy matching web */}
      <LinearGradient
        colors={["#134e4a", "#0f172a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      />

      {/* Decorative Circles */}
      <View style={styles.circlesContainer}>
        <View style={[styles.circle, styles.circle1]} />
        <View style={[styles.circle, styles.circle2]} />
        <View style={[styles.circle, styles.circle3]} />
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

          {/* Primary Button: Continue with Email */}
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.8 }]}
            onPress={handleEmailPress}
            accessibilityLabel="Continue with Email"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Continue with Email</Text>
          </Pressable>

          {/* Secondary Button: Continue with Google */}
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.8 }]}
            onPress={handleGooglePress}
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
          >
            <View style={styles.googleButtonContent}>
              <View style={styles.googleIcon}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <Text style={styles.secondaryButtonText}>Continue with Google</Text>
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
    backgroundColor: "rgba(20, 184, 166, 0.08)", // subtle teal tint
  },
  circle1: {
    width: width * 0.8,
    height: width * 0.8,
    top: -width * 0.2,
    right: -width * 0.3,
  },
  circle2: {
    width: width * 0.6,
    height: width * 0.6,
    top: height * 0.25,
    left: -width * 0.25,
  },
  circle3: {
    width: width * 0.5,
    height: width * 0.5,
    top: height * 0.5,
    right: -width * 0.15,
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
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
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
    backgroundColor: "#059669", // green matching web branding
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
    color: "#0f172a", // dark navy matching web
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b", // slate-500, muted gray matching web
    lineHeight: 24,
    marginBottom: 28,
  },

  // Buttons
  primaryButton: {
    backgroundColor: "#059669", // green matching web CTA
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "transparent",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#1e293b", // dark navy/slate border matching web
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
    borderColor: "#cbd5e1", // slate-300 matching web palette
  },
  googleIconText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#4285F4",
  },
  secondaryButtonText: {
    color: "#0f172a", // dark navy matching web
    fontSize: 16,
    fontWeight: "600",
  },
});
