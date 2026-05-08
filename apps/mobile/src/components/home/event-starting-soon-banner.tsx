import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Calendar, MapPin, Users, CheckCircle2 } from "lucide-react-native";

import { formatCountdown } from "@teammeet/core/calendar";
import { useNow } from "@/hooks/useNow";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { ENERGY, RADIUS, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface Props {
  eventId: string;
  title: string;
  location: string | null;
  startAt: string;
  attendingCount: number;
  checkedInCount: number;
  onPress: () => void;
}

export function EventStartingSoonBanner({
  title,
  location,
  startAt,
  attendingCount,
  checkedInCount,
  onPress,
}: Props) {
  const { neutral, semantic } = useAppColorScheme();
  const now = useNow(startAt);

  const startMs = Date.parse(startAt);
  const secondsUntil = Number.isFinite(startMs)
    ? Math.ceil((startMs - now.getTime()) / 1000)
    : 0;

  const isLive = secondsUntil <= 0;
  const accent = isLive ? ENERGY.live : semantic.info;
  const accentBg = isLive ? ENERGY.liveGlow : semantic.infoLight;

  const countdownLabel = isLive
    ? "Live now"
    : `Starts in ${formatCountdown(secondsUntil)}`;

  const styles = useThemedStyles((n) => ({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      overflow: "hidden" as const,
      ...SHADOWS.sm,
    },
    accentStripe: {
      height: 3,
      backgroundColor: accent,
    },
    body: {
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    headerRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    pill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      backgroundColor: accentBg,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 3,
      borderRadius: RADIUS.full,
    },
    pillLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: accent,
      fontWeight: "700" as const,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    metaRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
    },
    metaText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      flexShrink: 1,
    },
    countsRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      marginTop: SPACING.xs,
    },
    countItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
    },
    countText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    countLabel: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
  }));

  return (
    <Animated.View entering={FadeInDown.duration(280)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${countdownLabel}. ${attendingCount} attending, ${checkedInCount} checked in.`}
        style={styles.card}
      >
        <View style={styles.accentStripe} />
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <View style={styles.pill}>
              <Calendar size={12} color={accent} />
              <Text style={styles.pillLabel}>{countdownLabel}</Text>
            </View>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>

          {location ? (
            <View style={styles.metaRow}>
              <MapPin size={14} color={neutral.muted} />
              <Text style={styles.metaText} numberOfLines={1}>
                {location}
              </Text>
            </View>
          ) : null}

          <View style={styles.countsRow}>
            <View style={styles.countItem}>
              <Users size={14} color={neutral.muted} />
              <Text style={styles.countText}>{attendingCount}</Text>
              <Text style={styles.countLabel}>going</Text>
            </View>
            <View style={styles.countItem}>
              <CheckCircle2 size={14} color={neutral.muted} />
              <Text style={styles.countText}>{checkedInCount}</Text>
              <Text style={styles.countLabel}>checked in</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
