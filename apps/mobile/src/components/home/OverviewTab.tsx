import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import {
  Users,
  GraduationCap,
  Calendar,
  DollarSign,
  UserPlus,
  CalendarPlus,
  PenSquare,
} from "lucide-react-native";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { Skeleton } from "@/components/ui/Skeleton";
import type { OrgStats } from "@/hooks/useOrgStats";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface OverviewTabProps {
  orgSlug: string;
  stats: OrgStats;
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  loading?: boolean;
  onCreatePost?: () => void;
}

export function OverviewTab({
  orgSlug,
  stats,
  refreshing,
  onRefresh,
  onNavigate,
  loading = false,
  onCreatePost,
}: OverviewTabProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.sm,
    },
    // Hero row
    heroRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    heroCard: {
      flex: 1,
      backgroundColor: n.surface,
      borderRadius: RADIUS.xl,
      padding: SPACING.md,
      gap: SPACING.xs,
      ...SHADOWS.md,
    },
    heroIconWrapper: {
      alignSelf: "flex-end" as const,
      marginBottom: SPACING.xs,
    },
    heroValue: {
      ...TYPOGRAPHY.displayLarge,
      color: n.foreground,
    },
    heroLabel: {
      ...TYPOGRAPHY.overline,
      color: n.muted,
    },
    // Secondary row
    secondaryRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    secondaryCard: {
      flex: 1,
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      borderLeftWidth: 3,
      padding: SPACING.md,
      gap: SPACING.xs,
      ...SHADOWS.sm,
    },
    secondaryCardAlumni: {
      borderLeftColor: s.warning,
    },
    secondaryCardDonations: {
      borderLeftColor: s.success,
    },
    secondaryIconWrapper: {
      marginBottom: SPACING.xs,
    },
    secondaryValue: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
    },
    secondaryLabel: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    // Quick actions
    quickActionsRow: {
      flexDirection: "row" as const,
      justifyContent: "space-evenly" as const,
      gap: SPACING.sm,
    },
    quickActionButton: {
      flex: 1,
      flexDirection: "column" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.xs,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.lg,
      backgroundColor: n.surface,
    },
    quickActionLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    // Shared
    cardPressed: {
      opacity: 0.7,
    },
    // Skeleton cards
    heroSkeletonCard: {
      flex: 1,
    },
    secondarySkeletonCard: {
      flex: 1,
    },
  }));

  const quickActions = useMemo(
    () => [
      {
        icon: <UserPlus size={18} color={neutral.secondary} />,
        label: "Invite",
        path: `/(app)/${orgSlug}/members/new`,
        onPress: undefined as (() => void) | undefined,
      },
      {
        icon: <CalendarPlus size={18} color={neutral.secondary} />,
        label: "New Event",
        path: `/(app)/${orgSlug}/events/new`,
        onPress: undefined as (() => void) | undefined,
      },
      {
        icon: <PenSquare size={18} color={neutral.secondary} />,
        label: "Post",
        path: undefined as string | undefined,
        onPress: onCreatePost,
      },
    ],
    [orgSlug, onCreatePost, neutral.secondary]
  );

  if (loading) {
    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero row skeleton */}
        <View style={styles.heroRow}>
          <Skeleton height={96} borderRadius={RADIUS.xl} style={styles.heroSkeletonCard} />
          <Skeleton height={96} borderRadius={RADIUS.xl} style={styles.heroSkeletonCard} />
        </View>
        {/* Secondary row skeleton */}
        <View style={styles.secondaryRow}>
          <Skeleton height={72} borderRadius={RADIUS.lg} style={styles.secondarySkeletonCard} />
          <Skeleton height={72} borderRadius={RADIUS.lg} style={styles.secondarySkeletonCard} />
        </View>
        {/* Quick actions skeleton */}
        <Skeleton height={56} borderRadius={RADIUS.lg} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={semantic.success}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Hero stat row — Members + Events */}
      <View style={styles.heroRow}>
        <Pressable
          onPress={() => onNavigate(`/(app)/${orgSlug}/(tabs)/members`)}
          style={({ pressed }) => [styles.heroCard, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Active Members: ${stats.activeMembers}`}
        >
          <View style={styles.heroIconWrapper}>
            <Users size={28} color={semantic.info} />
          </View>
          <Text style={styles.heroValue}>{stats.activeMembers}</Text>
          <Text style={styles.heroLabel}>ACTIVE MEMBERS</Text>
        </Pressable>

        <Pressable
          onPress={() => onNavigate(`/(app)/${orgSlug}/(tabs)/calendar`)}
          style={({ pressed }) => [styles.heroCard, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Upcoming Events: ${stats.upcomingEvents}`}
        >
          <View style={styles.heroIconWrapper}>
            <Calendar size={28} color={semantic.success} />
          </View>
          <Text style={styles.heroValue}>{stats.upcomingEvents}</Text>
          <Text style={styles.heroLabel}>UPCOMING EVENTS</Text>
        </Pressable>
      </View>

      {/* Secondary stat row — Alumni + Donations */}
      <View style={styles.secondaryRow}>
        <Pressable
          onPress={() => onNavigate(`/(app)/${orgSlug}/(tabs)/alumni`)}
          style={({ pressed }) => [
            styles.secondaryCard,
            styles.secondaryCardAlumni,
            pressed && styles.cardPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Alumni: ${stats.alumni}`}
        >
          <View style={styles.secondaryIconWrapper}>
            <GraduationCap size={20} color={semantic.warning} />
          </View>
          <Text style={styles.secondaryValue}>{stats.alumni}</Text>
          <Text style={styles.secondaryLabel}>Alumni</Text>
        </Pressable>

        <Pressable
          onPress={() => onNavigate(`/(app)/${orgSlug}/donations`)}
          style={({ pressed }) => [
            styles.secondaryCard,
            styles.secondaryCardDonations,
            pressed && styles.cardPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Total Donations: $${stats.totalDonations.toLocaleString()}`}
        >
          <View style={styles.secondaryIconWrapper}>
            <DollarSign size={20} color={semantic.success} />
          </View>
          <Text style={styles.secondaryValue}>
            ${stats.totalDonations.toLocaleString()}
          </Text>
          <Text style={styles.secondaryLabel}>Total Donations</Text>
        </Pressable>
      </View>

      {/* Quick actions row */}
      <View style={styles.quickActionsRow}>
        {quickActions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress ?? (() => action.path && onNavigate(action.path))}
            style={({ pressed }) => [
              styles.quickActionButton,
              pressed && styles.cardPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            {action.icon}
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
