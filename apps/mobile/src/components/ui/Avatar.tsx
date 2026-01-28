/**
 * Avatar Component
 * User avatars with presence indicators and initials fallback
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { NEUTRAL, ENERGY, AVATAR_SIZES, PRESENCE_SIZES, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export type PresenceStatus = "online" | "away" | "offline" | "none";

// Deterministic color palette for initials (9 colors)
const AVATAR_COLORS = [
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#14b8a6", // teal-500
  "#0ea5e9", // sky-500
];

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: AvatarSize;
  presence?: PresenceStatus;
  borderColor?: string;
  style?: ViewStyle;
  // For Slack-style squircle (rounded square)
  squircle?: boolean;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getColorForName(name: string | null | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  // Simple hash based on character codes
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function getPresenceColor(status: PresenceStatus): string {
  switch (status) {
    case "online":
      return ENERGY.online;
    case "away":
      return ENERGY.away;
    case "offline":
      return ENERGY.offline;
    default:
      return "transparent";
  }
}

export const Avatar = React.memo(function Avatar({
  uri,
  name,
  size = "md",
  presence = "none",
  borderColor,
  style,
  squircle = false,
}: AvatarProps) {
  const avatarSize = AVATAR_SIZES[size];
  const presenceSize = PRESENCE_SIZES[size];
  const backgroundColor = useMemo(() => getColorForName(name), [name]);
  const initials = useMemo(() => getInitials(name), [name]);

  const fontSize = useMemo(() => {
    // Scale font size based on avatar size
    switch (size) {
      case "xs":
        return 10;
      case "sm":
        return 12;
      case "md":
        return 14;
      case "lg":
        return 16;
      case "xl":
        return 20;
      case "xxl":
        return 24;
    }
  }, [size]);

  const borderRadius = squircle ? avatarSize * 0.25 : avatarSize / 2;

  const containerStyle: ViewStyle = {
    width: avatarSize,
    height: avatarSize,
    borderRadius,
    ...(borderColor && {
      borderWidth: 2,
      borderColor,
    }),
  };

  const presenceStyle: ViewStyle = {
    width: presenceSize,
    height: presenceSize,
    borderRadius: presenceSize / 2,
    backgroundColor: getPresenceColor(presence),
    position: "absolute",
    bottom: 0,
    right: 0,
    borderWidth: 2,
    borderColor: NEUTRAL.surface,
  };

  const accessibilityLabel = name ? `${name}'s avatar` : "User avatar";
  const presenceLabel = presence !== "none" ? `, ${presence}` : "";

  return (
    <View
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={`${accessibilityLabel}${presenceLabel}`}
      style={[styles.container, containerStyle, style]}
    >
      {uri ? (
        <Image
          source={uri}
          style={[styles.image, { borderRadius }]}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          style={[
            styles.initialsContainer,
            { backgroundColor, borderRadius },
          ]}
        >
          <Text
            style={[
              styles.initials,
              { fontSize },
            ]}
          >
            {initials}
          </Text>
        </View>
      )}
      {presence !== "none" && <View style={presenceStyle} />}
    </View>
  );
});

// Avatar Group for showing multiple avatars stacked
interface AvatarGroupProps {
  avatars: Array<{ uri?: string | null; name?: string | null }>;
  size?: AvatarSize;
  max?: number;
  overlap?: number; // overlap in pixels
}

export const AvatarGroup = React.memo(function AvatarGroup({
  avatars,
  size = "sm",
  max = 4,
  overlap = 8,
}: AvatarGroupProps) {
  const displayAvatars = avatars.slice(0, max);
  const remaining = avatars.length - max;
  const avatarSize = AVATAR_SIZES[size];

  const totalCount = avatars.length;
  const displayedNames = displayAvatars
    .map((a) => a.name || "Unknown user")
    .join(", ");
  const groupLabel =
    remaining > 0
      ? `${totalCount} people: ${displayedNames}, and ${remaining} more`
      : `${totalCount} people: ${displayedNames}`;

  return (
    <View
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={groupLabel}
      style={styles.groupContainer}
    >
      {displayAvatars.map((avatar, index) => (
        <View
          key={index}
          style={[
            styles.groupItem,
            {
              marginLeft: index === 0 ? 0 : -overlap,
              zIndex: displayAvatars.length - index,
            },
          ]}
        >
          <Avatar
            uri={avatar.uri}
            name={avatar.name}
            size={size}
            borderColor={NEUTRAL.surface}
          />
        </View>
      ))}
      {remaining > 0 && (
        <View
          style={[
            styles.groupItem,
            styles.remainingContainer,
            {
              marginLeft: -overlap,
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
            },
          ]}
        >
          <Text style={styles.remainingText}>+{remaining}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  initialsContainer: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#ffffff",
    fontWeight: "600",
  },
  groupContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  groupItem: {
    // Ensures proper stacking
  },
  remainingContainer: {
    backgroundColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: NEUTRAL.surface,
  },
  remainingText: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.secondary,
  },
});
