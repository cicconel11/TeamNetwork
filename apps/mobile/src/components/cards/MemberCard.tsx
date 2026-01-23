/**
 * MemberCard Component
 * Member/alumni card with avatar, presence, and role indicators
 */

import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { ChevronRight, Mail, Phone } from "lucide-react-native";
import { NEUTRAL, RADIUS, SPACING, ANIMATION } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { Avatar, type PresenceStatus } from "@/components/ui/Avatar";
import { RoleBadge, Badge } from "@/components/ui/Badge";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface MemberCardMember {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  graduation_year?: number | null;
  role?: "admin" | "member" | "alumni" | null;
  presence?: PresenceStatus;
}

interface MemberCardProps {
  member: MemberCardMember;
  onPress?: () => void;
  style?: ViewStyle;
  showPresence?: boolean;
  showChevron?: boolean;
  showContactActions?: boolean;
}

function getDisplayName(member: MemberCardMember): string {
  if (member.first_name && member.last_name) {
    return `${member.first_name} ${member.last_name}`;
  }
  return member.first_name || member.email || "Unknown";
}

function getInitials(member: MemberCardMember): string {
  if (member.first_name && member.last_name) {
    return (member.first_name[0] + member.last_name[0]).toUpperCase();
  }
  return member.first_name?.[0]?.toUpperCase() || "?";
}

export function MemberCard({
  member,
  onPress,
  style,
  showPresence = false,
  showChevron = true,
  showContactActions = false,
}: MemberCardProps) {
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

  const displayName = getDisplayName(member);
  const initials = getInitials(member);
  const role = member.role as "admin" | "member" | "alumni" | null;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle, style]}
    >
      <Avatar
        uri={member.photo_url}
        name={displayName}
        size="md"
        presence={showPresence ? member.presence : "none"}
      />

      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>

        {member.email && (
          <Text style={styles.email} numberOfLines={1}>
            {member.email}
          </Text>
        )}
      </View>

      <View style={styles.right}>
        {/* Role and class chips */}
        <View style={styles.chips}>
          {member.graduation_year && (
            <Badge variant="neutral" size="sm">
              '{String(member.graduation_year).slice(-2)}
            </Badge>
          )}
          {role && role !== "member" && (
            <RoleBadge role={role} size="sm" />
          )}
        </View>

        {showChevron && (
          <ChevronRight size={18} color={NEUTRAL.border} />
        )}
      </View>
    </AnimatedPressable>
  );
}

// Compact member card for lists with many items
interface MemberCardCompactProps {
  member: MemberCardMember;
  onPress?: () => void;
  style?: ViewStyle;
}

export function MemberCardCompact({
  member,
  onPress,
  style,
}: MemberCardCompactProps) {
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

  const displayName = getDisplayName(member);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.compactContainer, animatedStyle, style]}
    >
      <Avatar
        uri={member.photo_url}
        name={displayName}
        size="sm"
      />

      <Text style={styles.compactName} numberOfLines={1}>
        {displayName}
      </Text>

      {member.role === "admin" && (
        <RoleBadge role="admin" size="sm" />
      )}
    </AnimatedPressable>
  );
}

// Group header for member sections
interface MemberGroupHeaderProps {
  title: string;
  count: number;
  style?: ViewStyle;
}

export function MemberGroupHeader({
  title,
  count,
  style,
}: MemberGroupHeaderProps) {
  return (
    <View style={[styles.groupHeader, style]}>
      <Text style={styles.groupTitle}>{title}</Text>
      <Text style={styles.groupCount}>({count})</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.sm,
    gap: SPACING.md,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  email: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  // Compact styles
  compactContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.sm,
  },
  compactName: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    flex: 1,
  },

  // Group header styles
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    gap: SPACING.xs,
  },
  groupTitle: {
    ...TYPOGRAPHY.overline,
    color: NEUTRAL.secondary,
  },
  groupCount: {
    ...TYPOGRAPHY.caption,
    color: NEUTRAL.muted,
  },
});
