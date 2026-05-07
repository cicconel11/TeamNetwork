import { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";
import { Users, Calendar, Trophy } from "lucide-react-native";
import { useOnboarding } from "@/hooks/useOnboarding";

/** Lucide RN icons share the same component shape; use typeof for a precise match. */
type WelcomeIcon = typeof Users;

interface Page {
  key: string;
  Icon: WelcomeIcon;
  title: string;
  subtitle: string;
  gradientColors: [string, string, string];
}

const PAGES: Page[] = [
  {
    key: "connect",
    Icon: Users,
    title: "Connect with your team",
    subtitle: "Stay in sync with teammates, coaches, and staff all in one place.",
    gradientColors: ["#134e4a", "#0f172a", "#0f172a"],
  },
  {
    key: "organize",
    Icon: Calendar,
    title: "Stay organized",
    subtitle: "Track events, schedules, and announcements effortlessly.",
    gradientColors: ["#1e3a5f", "#0f172a", "#0f172a"],
  },
  {
    key: "legacy",
    Icon: Trophy,
    title: "Build your legacy",
    subtitle: "Celebrate achievements and connect alumni to current players.",
    gradientColors: ["#3b1f5e", "#0f172a", "#0f172a"],
  },
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { markWelcomeSeen } = useOnboarding();
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const newIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentIndex((prev) => {
      if (newIndex !== prev && Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return newIndex;
    });
  }, [width]);

  const handleGetStarted = useCallback(async () => {
    if (Platform.OS === "ios") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await markWelcomeSeen();
    router.replace("/(auth)");
  }, [markWelcomeSeen, router]);

  const renderPage = useCallback(({ item, index }: { item: Page; index: number }) => {
    const { Icon, title, subtitle, gradientColors } = item;
    const isLast = index === PAGES.length - 1;

    return (
      <View style={[styles.page, { width }]}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.pageContent} edges={["top", "bottom"]}>
          <View style={styles.iconContainer}>
            <Icon size={72} color="#14b8a6" />
          </View>
          <Text style={styles.pageTitle}>{title}</Text>
          <Text style={styles.pageSubtitle}>{subtitle}</Text>
          {isLast && (
            <Pressable
              style={({ pressed }) => [styles.getStartedButton, pressed && { opacity: 0.8 }]}
              onPress={handleGetStarted}
              accessibilityLabel="Get Started"
              accessibilityRole="button"
            >
              <Text style={styles.getStartedButtonText}>Get Started</Text>
            </Pressable>
          )}
        </SafeAreaView>
      </View>
    );
  }, [width, handleGetStarted]);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={PAGES}
        keyExtractor={(item) => item.key}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
      />

      {/* Dot indicators */}
      <View style={styles.dotsContainer}>
        {PAGES.map((page, index) => (
          <Animated.View
            key={page.key}
            entering={FadeIn.delay(index * 100)}
            style={[styles.dot, index === currentIndex && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  page: {
    flex: 1,
    overflow: "hidden",
  },
  pageContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingBottom: 80,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 32,
    backgroundColor: "rgba(20, 184, 166, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: "700",
    color: "#f8fafc",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 38,
  },
  pageSubtitle: {
    fontSize: 17,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 48,
  },
  getStartedButton: {
    backgroundColor: "#059669",
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  getStartedButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  dotsContainer: {
    position: "absolute",
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    pointerEvents: "none",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  dotActive: {
    backgroundColor: "#ffffff",
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
