import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { Calendar, Megaphone, ChevronRight } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { EventCard } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import type { EventCardEvent } from "@/components/cards/EventCard";
import type { AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll: () => void }) {
  const { neutral } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
    },
    seeAllButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
    },
    seeAllText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
  }));

  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.seeAllButton,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onSeeAll}
        accessibilityRole="button"
        accessibilityLabel={`See all ${title.toLowerCase()}`}
      >
        <Text style={styles.seeAllText}>See all</Text>
        <ChevronRight size={16} color={neutral.secondary} />
      </Pressable>
    </View>
  );
}

interface EventsTabProps {
  orgSlug: string;
  events: EventCardEvent[];
  announcements: AnnouncementCardAnnouncement[];
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  /**
   * Invoked when a user taps the RSVP button on an event card. Parent is
   * responsible for prompting the user, persisting the choice, and
   * refetching events so the card reflects the new status.
   */
  onRsvp?: (eventId: string) => void;
}

export function EventsTab({
  orgSlug,
  events,
  announcements,
  refreshing,
  onRefresh,
  onNavigate,
  onRsvp,
}: EventsTabProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xl,
      gap: SPACING.lg,
    },
    section: {
      gap: SPACING.sm,
    },
    cardList: {
      gap: SPACING.sm,
    },
    emptyState: {
      alignItems: "center" as const,
      paddingVertical: SPACING.xl,
      gap: SPACING.sm,
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderStyle: "dashed" as const,
      borderColor: n.border,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
    },
    nextUpLabel: {
      ...TYPOGRAPHY.overline,
      color: s.success,
      marginBottom: SPACING.xs,
    },
  }));

  const handleEventPress = useCallback(
    (eventId: string) => onNavigate(`/(app)/${orgSlug}/events/${eventId}`),
    [onNavigate, orgSlug]
  );

  const handleAnnouncementPress = useCallback(
    (announcementId: string) => onNavigate(`/(app)/${orgSlug}/announcements/${announcementId}`),
    [onNavigate, orgSlug]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={semantic.success}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Upcoming Events section */}
      <View style={styles.section}>
        <SectionHeader
          title="Upcoming Events"
          onSeeAll={() => onNavigate(`/(app)/${orgSlug}/(tabs)/calendar`)}
        />

        {events.length === 0 ? (
          <View style={styles.emptyState}>
            <Calendar size={32} color={neutral.disabled} />
            <Text style={styles.emptyText}>No upcoming events</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {events.map((event, index) => (
              <View key={event.id}>
                {index === 0 && (
                  <Text style={styles.nextUpLabel}>NEXT UP</Text>
                )}
                <EventCard
                  event={event}
                  onPress={() => handleEventPress(event.id)}
                  onRSVP={
                    onRsvp ? () => onRsvp(event.id) : () => handleEventPress(event.id)
                  }
                  accentColor={semantic.success}
                  style={index === 0 ? { backgroundColor: semantic.successLight } : undefined}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Recent Announcements section */}
      <View style={styles.section}>
        <SectionHeader
          title="Recent Announcements"
          onSeeAll={() => onNavigate(`/(app)/${orgSlug}/(tabs)/announcements`)}
        />

        {announcements.length === 0 ? (
          <View style={styles.emptyState}>
            <Megaphone size={32} color={neutral.disabled} />
            <Text style={styles.emptyText}>No announcements</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {announcements.map((announcement) => (
              <AnnouncementCardCompact
                key={announcement.id}
                announcement={announcement}
                onPress={() => handleAnnouncementPress(announcement.id)}
                style={announcement.is_pinned ? { borderLeftWidth: 3, borderLeftColor: semantic.warning } : undefined}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
