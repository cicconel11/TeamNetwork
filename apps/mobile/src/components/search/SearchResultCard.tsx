import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { User, Calendar, Megaphone } from "lucide-react-native";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { SearchResult } from "@/hooks/useGlobalSearch";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const TYPE_CONFIG: Record<
  SearchResult["type"],
  { label: string; color: string; bg: string; Icon: typeof User }
> = {
  member: {
    label: "Member",
    color: "#0369a1",
    bg: "#e0f2fe",
    Icon: User,
  },
  event: {
    label: "Event",
    color: "#047857",
    bg: "#d1fae5",
    Icon: Calendar,
  },
  announcement: {
    label: "Post",
    color: "#7c3aed",
    bg: "#ede9fe",
    Icon: Megaphone,
  },
};

interface SearchResultCardProps {
  result: SearchResult;
  index: number;
  onPress: (result: SearchResult) => void;
}

export function SearchResultCard({ result, index, onPress }: SearchResultCardProps) {
  const config = TYPE_CONFIG[result.type];
  const { Icon } = config;

  const styles = useThemedStyles((n) => ({
    card: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      // @ts-ignore — iOS continuous corner curves
      borderCurve: "continuous",
      padding: SPACING.md,
      marginHorizontal: SPACING.md,
      marginBottom: SPACING.sm,
      borderWidth: 1,
      borderColor: n.border,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    cardPressed: {
      opacity: 0.75,
    },
    iconContainer: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      flexShrink: 0,
    },
    textContainer: {
      flex: 1,
    },
    title: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    subtitle: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    badge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 3,
      borderRadius: RADIUS.full,
      flexShrink: 0,
    },
    badgeText: {
      ...TYPOGRAPHY.caption,
      fontWeight: "600" as const,
    },
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 50)}>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => onPress(result)}
        accessibilityRole="button"
        accessibilityLabel={`${config.label}: ${result.title}`}
      >
        <View style={[styles.iconContainer, { backgroundColor: config.bg }]}>
          <Icon size={18} color={config.color} />
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.title} selectable numberOfLines={1}>
            {result.title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {result.subtitle}
          </Text>
        </View>

        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
