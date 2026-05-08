import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ChevronRight } from "lucide-react-native";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";

interface Chip {
  label: string;
  key: string;
}

interface DirectoryCardProps {
  avatarUrl?: string | null;
  initials: string;
  name: string;
  subtitle?: string | null;
  locationLine?: string | null;
  locationIcon?: React.ReactNode;
  chips?: Chip[];
  onPress?: () => void;
  colors: ThemeColors;
  /** Renders a green dot over the avatar when true. */
  online?: boolean;
}

export const DirectoryCard = React.memo(function DirectoryCard({
  avatarUrl,
  initials,
  name,
  subtitle,
  locationLine,
  locationIcon,
  chips = [],
  onPress,
  colors,
  online,
}: DirectoryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.avatarWrap}>
        {avatarUrl ? (
          <Image source={avatarUrl} style={styles.avatar} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.avatarText, { color: colors.primaryDark }]}>{initials}</Text>
          </View>
        )}
        {online ? (
          <View style={[styles.onlineDot, { borderColor: colors.card }]} />
        ) : null}
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {locationLine && (
          <View style={styles.locationRow}>
            {locationIcon}
            <Text style={[styles.location, { color: colors.mutedForeground }]} numberOfLines={1}>
              {locationLine}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.cardRight}>
        {chips.length > 0 && (
          <View style={styles.cardChipColumn}>
            {chips.map((chip) => (
              <View key={chip.key} style={[styles.cardChip, { backgroundColor: colors.mutedSurface }]}>
                <Text style={[styles.cardChipText, { color: colors.muted }]} numberOfLines={1}>
                  {chip.label}
                </Text>
              </View>
            ))}
          </View>
        )}
        <ChevronRight size={16} color={colors.border} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs + 2,
  },
  cardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.995 }],
  },
  avatarWrap: {
    position: "relative",
    marginRight: spacing.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#22c55e",
    borderWidth: 2,
  },
  avatarText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    lineHeight: 20,
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginTop: 1,
    lineHeight: 18,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 3,
  },
  location: {
    fontSize: fontSize.xs,
  },
  cardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  cardChipColumn: {
    alignItems: "flex-end",
    gap: 4,
  },
  cardChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 12,
    maxWidth: 72,
  },
  cardChipText: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
});
