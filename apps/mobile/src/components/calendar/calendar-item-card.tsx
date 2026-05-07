import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { Clock, MapPin } from "lucide-react-native";

import { track } from "@/lib/analytics";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { RADIUS, SHADOWS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { getEventColor } from "./event-type-colors";
import type { UnifiedCalendarItem } from "@/hooks/useUnifiedCalendar";

interface CalendarItemCardProps {
  item: UnifiedCalendarItem;
  orgSlug: string;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function formatTimeRange(startAt: string, endAt: string | null): string {
  const start = timeFmt.format(new Date(startAt));
  if (!endAt) return start;
  return `${start} – ${timeFmt.format(new Date(endAt))}`;
}

export function CalendarItemCard({ item, orgSlug }: CalendarItemCardProps) {
  const { neutral } = useAppColorScheme();
  const color = useMemo(
    () => getEventColor(item.eventType, item.sourceType),
    [item.eventType, item.sourceType]
  );

  const styles = useThemedStyles((n, s) => ({
    card: {
      flexDirection: "row" as const,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      overflow: "hidden" as const,
      ...SHADOWS.sm,
    },
    cardPressed: {
      opacity: 0.6,
    },
    accent: {
      width: 4,
      backgroundColor: color.text,
    },
    body: {
      flex: 1,
      padding: SPACING.md,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      fontWeight: "600" as const,
      marginBottom: 4,
    },
    detailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginTop: 2,
    },
    detailText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
      fontVariant: ["tabular-nums"] as const,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
    },
    sourceLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: color.text,
      marginBottom: 4,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
  }));

  const href = useMemo(() => {
    if (item.sourceType === "event" && item.eventId) {
      return `/(app)/${orgSlug}/events/${item.eventId}`;
    }
    if (item.sourceType === "schedule" && item.scheduleId) {
      return `/(app)/${orgSlug}/schedules/${item.scheduleId}/edit`;
    }
    return `/(app)/${orgSlug}`;
  }, [item, orgSlug]);

  const accessibilityLabel = `${item.title}, ${item.sourceName}`;

  return (
    <Link href={href as never} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => {
          track("calendar_event_tapped", {
            source_type: item.sourceType,
            org_slug: orgSlug,
          });
        }}
      >
        <View style={styles.accent} />
        <View style={styles.body}>
          <Text style={styles.sourceLabel}>{item.sourceName}</Text>
          <Text style={styles.title} numberOfLines={2} selectable>
            {item.title}
          </Text>

          <View style={styles.detailRow}>
            <Clock size={13} color={neutral.secondary} />
            <Text style={styles.detailText} selectable>
              {formatTimeRange(item.startAt, item.endAt)}
            </Text>
          </View>

          {item.location && (
            <View style={styles.detailRow}>
              <MapPin size={13} color={neutral.secondary} />
              <Text style={styles.locationText} numberOfLines={1} selectable>
                {item.location}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Link>
  );
}
