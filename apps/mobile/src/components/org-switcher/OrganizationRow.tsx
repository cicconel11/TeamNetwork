import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ChevronRight, Check } from "lucide-react-native";

const colors = {
  background: "#ffffff",
  pressed: "#f1f5f9",
  title: "#0f172a",
  subtitle: "#64748b",
  muted: "#94a3b8",
  chevron: "#cbd5e1",
  avatarBg: "#f1f5f9",
  avatarText: "#475569",
  divider: "#e2e8f0",
};

interface OrganizationRowProps {
  org: { id: string; name: string; slug: string; logo_url?: string | null };
  isCurrent?: boolean;
  onPress: () => void;
}

export function OrganizationRow({ org, isCurrent, onPress }: OrganizationRowProps) {
  const initials = getOrgInitials(org);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${org.name}${isCurrent ? " (current)" : ""}`}
    >
      <View style={styles.avatar}>
        {org.logo_url ? (
          <Image source={org.logo_url} style={styles.avatarImage} contentFit="contain" transition={200} />
        ) : (
          <Text style={styles.avatarText}>{initials}</Text>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {org.name}
          </Text>
          {isCurrent && <Check size={14} color={colors.muted} style={styles.checkIcon} />}
        </View>
        <Text style={styles.slug} numberOfLines={1}>
          @{org.slug}
        </Text>
      </View>

      <ChevronRight size={16} color={colors.chevron} />
    </Pressable>
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
    backgroundColor: colors.background,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowPressed: {
    backgroundColor: colors.pressed,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.avatarBg,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginRight: 12,
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: 4,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.avatarText,
  },
  info: {
    flex: 1,
    paddingRight: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.title,
  },
  checkIcon: {
    marginLeft: 6,
  },
  slug: {
    fontSize: 13,
    color: colors.subtitle,
    marginTop: 1,
  },
});
