import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  User,
  Calendar,
  Megaphone,
  MessageCircle,
  Briefcase,
  GraduationCap,
  ChevronRight,
} from "lucide-react-native";
import { SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { SearchResult, SearchEntityType } from "@/hooks/useGlobalSearch";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";

const TYPE_ICON: Record<SearchEntityType, typeof User> = {
  member: User,
  alumni: GraduationCap,
  event: Calendar,
  announcement: Megaphone,
  discussion_thread: MessageCircle,
  job_posting: Briefcase,
};

const TYPE_LABEL: Record<SearchEntityType, string> = {
  member: "Member",
  alumni: "Alumni",
  event: "Event",
  announcement: "Post",
  discussion_thread: "Chat",
  job_posting: "Job",
};

interface SearchResultCardProps {
  result: SearchResult;
  index: number;
  onPress: (result: SearchResult) => void;
}

export function SearchResultCard({ result, index, onPress }: SearchResultCardProps) {
  const Icon = TYPE_ICON[result.type];
  const { neutral } = useAppColorScheme();

  const styles = useThemedStyles((n) => ({
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: n.surface,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      gap: SPACING.md,
    },
    rowPressed: {
      backgroundColor: n.background,
    },
    iconWrap: {
      width: 28,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    textWrap: {
      flex: 1,
      minWidth: 0,
    },
    titleRow: {
      flexDirection: "row" as const,
      alignItems: "baseline" as const,
      gap: SPACING.sm,
    },
    title: {
      ...TYPOGRAPHY.bodyMedium,
      fontWeight: "600" as const,
      color: n.foreground,
      flexShrink: 1,
    },
    label: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      letterSpacing: 0.3,
      textTransform: "uppercase" as const,
    },
    snippet: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginTop: 1,
    },
    divider: {
      height: 1,
      backgroundColor: n.border,
      marginLeft: SPACING.md + 28 + SPACING.md,
      opacity: 0.5,
    },
  }));

  return (
    <Animated.View entering={FadeIn.duration(180).delay(Math.min(index, 8) * 24)}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => onPress(result)}
        accessibilityRole="button"
        accessibilityLabel={`${TYPE_LABEL[result.type]}: ${result.title}`}
      >
        <View style={styles.iconWrap}>
          <Icon size={20} color={neutral.muted} strokeWidth={1.75} />
        </View>

        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {result.title}
            </Text>
            <Text style={styles.label}>{TYPE_LABEL[result.type]}</Text>
          </View>
          {result.snippet ? (
            <Text style={styles.snippet} numberOfLines={1}>
              {result.snippet}
            </Text>
          ) : null}
        </View>

        <ChevronRight size={16} color={neutral.border} strokeWidth={2} />
      </Pressable>
      <View style={styles.divider} />
    </Animated.View>
  );
}
