/**
 * JobCard Component
 * Card for displaying job postings with location/experience badges
 */

import React, { useCallback } from "react";
import { View, Text, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Briefcase, MapPin, Building2 } from "lucide-react-native";
import { RADIUS, SPACING, SHADOWS, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { JobPostingWithPoster } from "@/types/jobs";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface JobCardProps {
  job: JobPostingWithPoster;
  onPress?: () => void;
  style?: ViewStyle;
}

function buildLocationTypeConfig(semantic: { infoLight: string; infoDark: string; warningLight: string; warningDark: string; successLight: string; successDark: string }) {
  return {
    remote: { label: "Remote", bg: semantic.infoLight, color: semantic.infoDark },
    onsite: { label: "On-site", bg: semantic.warningLight, color: semantic.warningDark },
    hybrid: { label: "Hybrid", bg: semantic.successLight, color: semantic.successDark },
  } as Record<string, { label: string; bg: string; color: string }>;
}

// Experience level badge config
const EXPERIENCE_LEVEL_CONFIG: Record<string, string> = {
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior",
  executive: "Executive",
};

function formatRelativeDate(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export const JobCard = React.memo(function JobCard({
  job,
  onPress,
  style,
}: JobCardProps) {
  const { neutral, semantic } = useAppColorScheme();
  const locationTypeConfig = buildLocationTypeConfig(semantic);
  const styles = useThemedStyles((n) => ({
    container: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      ...SHADOWS.sm,
      // @ts-ignore — iOS continuous corner curves
      borderCurve: "continuous",
    },
    header: {
      flexDirection: "row" as const,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    iconContainer: {
      width: 40,
      height: 40,
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    titleBlock: {
      flex: 1,
      gap: 3,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    companyRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
    },
    company: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
    },
    locationRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      flex: 1,
    },
    badgeRow: {
      flexDirection: "row" as const,
      gap: SPACING.xs,
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.sm,
      flexWrap: "wrap" as const,
    },
    badge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs,
      borderRadius: RADIUS.full,
    },
    badgeText: {
      ...TYPOGRAPHY.labelSmall,
    },
    badgeNeutral: {
      backgroundColor: n.background,
    },
    badgeTextNeutral: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: n.divider,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    footerText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
  }));

  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, ANIMATION.spring);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, ANIMATION.spring);
  }, [scale]);

  const locationConfig = job.location_type
    ? locationTypeConfig[job.location_type]
    : null;

  const experienceLabel = job.experience_level
    ? EXPERIENCE_LEVEL_CONFIG[job.experience_level]
    : null;

  const posterName = job.poster?.name ?? "Unknown";
  const relativeDate = formatRelativeDate(job.created_at);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle, style]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Briefcase size={20} color={neutral.secondary} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
          <View style={styles.companyRow}>
            <Building2 size={13} color={neutral.muted} />
            <Text style={styles.company} selectable numberOfLines={1}>
              {job.company}
            </Text>
          </View>
          {job.location != null && (
            <View style={styles.locationRow}>
              <MapPin size={13} color={neutral.muted} />
              <Text style={styles.locationText} numberOfLines={1}>
                {job.location}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Badges */}
      {(locationConfig != null || experienceLabel != null) && (
        <View style={styles.badgeRow}>
          {locationConfig != null && (
            <View style={[styles.badge, { backgroundColor: locationConfig.bg }]}>
              <Text style={[styles.badgeText, { color: locationConfig.color }]}>
                {locationConfig.label}
              </Text>
            </View>
          )}
          {experienceLabel != null && (
            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={styles.badgeTextNeutral}>{experienceLabel}</Text>
            </View>
          )}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Posted by {posterName} · {relativeDate}
        </Text>
      </View>
    </AnimatedPressable>
  );
});
