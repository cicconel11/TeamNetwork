import React, { useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { Image } from "expo-image";
import { ShieldOff } from "lucide-react-native";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

export interface BlockedListItemUser {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface BlockedListItemProps {
  user: BlockedListItemUser;
  loading: boolean;
  onUnblock: (userId: string) => Promise<void> | void;
}

export function BlockedListItem({ user, loading, onUnblock }: BlockedListItemProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
      gap: SPACING.md,
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      marginBottom: SPACING.sm,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    avatarFallback: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarFallbackText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.secondary,
      fontWeight: "600" as const,
    },
    meta: {
      flex: 1,
    },
    name: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    unblockButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.sm,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
    },
    unblockText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
  }));

  const displayName = user.full_name?.trim() || "Unknown user";
  const initial = (displayName[0] || "?").toUpperCase();

  const handlePress = useCallback(() => {
    Alert.alert(
      "Unblock this user?",
      "Their content will be visible again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: () => {
            void onUnblock(user.id);
          },
        },
      ],
    );
  }, [onUnblock, user.id]);

  return (
    <View style={styles.row}>
      {user.avatar_url ? (
        <Image
          source={user.avatar_url}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>{initial}</Text>
        </View>
      )}
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
      </View>
      <Pressable
        onPress={handlePress}
        disabled={loading}
        style={({ pressed }) => [
          styles.unblockButton,
          (pressed || loading) && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Unblock ${displayName}`}
      >
        {loading ? (
          <ActivityIndicator size="small" color={neutral.foreground} />
        ) : (
          <ShieldOff size={16} color={neutral.foreground} />
        )}
        <Text style={styles.unblockText}>Unblock</Text>
      </Pressable>
    </View>
  );
}
