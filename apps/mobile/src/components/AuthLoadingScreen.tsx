/**
 * AuthLoadingScreen
 * Branded skeleton loading screen shown during app initialization.
 * Uses APP_CHROME colors for consistent visual identity.
 */

import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, RADIUS, SPACING } from "@/lib/design-tokens";

// Skeleton shimmer component
function ShimmerPlaceholder({
  width,
  height,
  borderRadius = RADIUS.md,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
}) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 1000, easing: Easing.ease }),
        withTiming(0.3, { duration: 1000, easing: Easing.ease })
      ),
      -1
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: NEUTRAL.border,
        },
        style,
        animatedStyle,
      ]}
    />
  );
}

// Skeleton org card
function SkeletonOrgCard() {
  return (
    <View style={styles.orgCard}>
      {/* Logo placeholder */}
      <ShimmerPlaceholder width={48} height={48} borderRadius={24} />

      {/* Text placeholders */}
      <View style={styles.orgCardText}>
        <ShimmerPlaceholder width="70%" height={18} style={{ marginBottom: 8 }} />
        <ShimmerPlaceholder width="40%" height={14} />
      </View>
    </View>
  );
}

export default function AuthLoadingScreen() {
  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.header}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            {/* Logo skeleton */}
            <ShimmerPlaceholder
              width={36}
              height={36}
              borderRadius={18}
              style={{ opacity: 0.4 }}
            />

            {/* Title skeleton */}
            <View style={styles.headerTextContainer}>
              <ShimmerPlaceholder
                width={140}
                height={20}
                style={{ marginBottom: 6, opacity: 0.4 }}
              />
              <ShimmerPlaceholder width={80} height={14} style={{ opacity: 0.3 }} />
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* Organization cards skeleton */}
        <View style={styles.cardList}>
          <SkeletonOrgCard />
          <SkeletonOrgCard />
          <SkeletonOrgCard />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  header: {
    paddingBottom: SPACING.md,
  },
  headerSafeArea: {
    // SafeAreaView handles top inset
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    minHeight: 56,
    gap: SPACING.sm,
  },
  headerTextContainer: {
    flex: 1,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
    paddingTop: SPACING.md,
  },
  cardList: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  orgCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  orgCardText: {
    flex: 1,
  },
});
