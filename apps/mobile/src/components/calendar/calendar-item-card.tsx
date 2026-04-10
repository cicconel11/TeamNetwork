import React, { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { BookOpen, Calendar as CalendarIcon, Clock, MapPin } from "lucide-react-native";

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
      backgroundColor: color.bg,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderLeftWidth: 3,
      borderColor: n.border,
      borderLeftColor: color.text,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    cardPressed: {
      opacity: 0.7,
    },
    headerRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    sourceBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      borderRadius: RADIUS.full,
      borderCurve: "continuous" as const,
      backgroundColor: color.bg,
    },
    sourceBadgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: color.text,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: color.text,
      marginBottom: SPACING.xs,
      fontWeight: "600" as const,
    },
    detailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginTop: 2,
    },
    detailText: {
      ...TYPOGRAPHY.bodySmall,
      color: color.text,
      opacity: 0.8,
      flex: 1,
      fontVariant: ["tabular-nums"] as const,
    },
    locationText: {
      ...TYPOGRAPHY.bodySmall,
      color: color.text,
      opacity: 0.7,
      flex: 1,
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

  const isEvent = item.sourceType === "event";
  const SourceIcon = isEvent ? CalendarIcon : BookOpen;
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
        <View style={styles.headerRow}>
          <View style={styles.sourceBadge}>
            <SourceIcon size={12} color={color.text} />
            <Text style={styles.sourceBadgeText}>{item.sourceName}</Text>
          </View>
        </View>

        <Text style={styles.title} numberOfLines={2} selectable>
          {item.title}
        </Text>

        <View style={styles.detailRow}>
          <Clock size={13} color={color.text} />
          <Text style={styles.detailText} selectable>
            {formatTimeRange(item.startAt, item.endAt)}
          </Text>
        </View>

        {item.location && (
          <View style={styles.detailRow}>
            <MapPin size={13} color={color.text} />
            <Text style={styles.locationText} numberOfLines={1} selectable>
              {item.location}
            </Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}
