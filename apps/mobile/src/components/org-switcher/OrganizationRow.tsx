import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ChevronRight, Check } from "lucide-react-native";
import { NEUTRAL, RADIUS, SPACING } from "@/lib/design-tokens";

interface OrganizationRowProps {
  org: { id: string; name: string; slug: string; logo_url?: string | null };
  isCurrent?: boolean;
  onPress: () => void;
  /** Used when rendered inside a grouped card — controls divider and corner rounding */
  isFirst?: boolean;
  isLast?: boolean;
  showDivider?: boolean;
}

export function OrganizationRow({
  org,
  isCurrent,
  onPress,
  isFirst,
  isLast,
  showDivider = true,
}: OrganizationRowProps) {
  const initials = getOrgInitials(org);

  const cornerStyle =
    isFirst !== undefined || isLast !== undefined
      ? {
          borderTopLeftRadius: isFirst ? RADIUS.xl : 0,
          borderTopRightRadius: isFirst ? RADIUS.xl : 0,
          borderBottomLeftRadius: isLast ? RADIUS.xl : 0,
          borderBottomRightRadius: isLast ? RADIUS.xl : 0,
        }
      : undefined;

  return (
    <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          cornerStyle,
          pressed && styles.rowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${org.name}${isCurrent ? " (current)" : ""}`}
      >
        <View style={styles.avatar}>
          {org.logo_url ? (
            <Image
              source={org.logo_url}
              style={styles.avatarImage}
              contentFit="contain"
              transition={200}
            />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {org.name}
            </Text>
            {isCurrent && (
              <Check size={14} color={NEUTRAL.muted} style={styles.checkIcon} />
            )}
          </View>
          <Text style={styles.slug} numberOfLines={1}>
            @{org.slug}
          </Text>
        </View>

        <ChevronRight size={20} color={NEUTRAL.muted} />
      </Pressable>

      {showDivider && <View style={styles.divider} />}
    </>
  );
}

function getOrgInitials(org: { name?: string; slug?: string }) {
  const source = (org.name || org.slug || "").trim();
  if (!source) return "O";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  rowPressed: {
    backgroundColor: NEUTRAL.divider,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: NEUTRAL.background,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginRight: SPACING.sm + 4,
  },
  avatarImage: {
    width: 32,
    height: 32,
    borderRadius: 6,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "600",
    color: NEUTRAL.secondary,
  },
  info: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: NEUTRAL.foreground,
  },
  checkIcon: {
    marginLeft: 6,
  },
  slug: {
    fontSize: 13,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: NEUTRAL.border,
    marginLeft: SPACING.md + 40 + SPACING.sm + 4, // align with text, not avatar
  },
});
