import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Calendar, MapPin, Users, ChevronLeft, UserCheck, Edit3, XCircle, ExternalLink, List } from "lucide-react-native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import type { Event } from "@/hooks/useEvents";
import { APP_CHROME } from "@/lib/chrome";
import { SEMANTIC, NEUTRAL, SPACING, RADIUS, RSVP_COLORS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatShortWeekdayDate, formatTime } from "@/lib/date-format";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";

const DETAIL_COLORS = {
  background: "#ffffff",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#f8fafc",
  success: "#059669",
  error: "#ef4444",
};

type RSVPStatus = "attending" | "not_attending" | "maybe";

interface RSVP {
  id: string;
  user_id: string;
  status: RSVPStatus;
  users: {
    name: string | null;
    email: string | null;
  } | null;
}

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const [event, setEvent] = useState<Event | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const fetchEvent = useCallback(async () => {
    if (!eventId || !orgSlug) return;

    try {
      setLoading(true);
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!orgData) throw new Error("Organization not found");

      const { data, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .eq("organization_id", orgData.id)
        .is("deleted_at", null)
        .single();

      if (eventError) throw eventError;
      setEvent(data as Event);

      // Fetch RSVPs for admin view
      const { data: rsvpData } = await supabase
        .from("event_rsvps")
        .select("id, user_id, status, users(name, email)")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (rsvpData) {
        setRsvps(rsvpData as unknown as RSVP[]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventId, orgSlug]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Admin action handlers
  const handleEditEvent = useCallback(() => {
    router.push(`/(app)/${orgSlug}/events/${eventId}/edit`);
  }, [router, orgSlug, eventId]);

  const handleViewRsvps = useCallback(() => {
    router.push(`/(app)/${orgSlug}/events/${eventId}/rsvps`);
  }, [router, orgSlug, eventId]);

  const handleCancelEvent = useCallback(() => {
    Alert.alert(
      "Cancel Event",
      "Are you sure you want to cancel this event? This action cannot be undone.",
      [
        { text: "Keep Event", style: "cancel" },
        {
          text: "Cancel Event",
          style: "destructive",
          onPress: async () => {
            if (!orgId || !eventId) return;
            setIsCancelling(true);
            try {
              const { error: updateError } = await supabase
                .from("events")
                .update({ deleted_at: new Date().toISOString() })
                .eq("id", eventId)
                .eq("organization_id", orgId);

              if (updateError) throw updateError;
              router.back();
            } catch (e) {
              Alert.alert("Error", (e as Error).message || "Failed to cancel event");
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  }, [orgId, eventId, router]);

  const handleOpenInWeb = useCallback(() => {
    const webUrl = `https://www.myteamnetwork.com/${orgSlug}/events/${eventId}`;
    Linking.openURL(webUrl);
  }, [orgSlug, eventId]);

  // Admin menu items
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "edit",
        label: "Edit Event",
        icon: <Edit3 size={20} color={NEUTRAL.foreground} />,
        onPress: handleEditEvent,
      },
      {
        id: "view-rsvps",
        label: "View RSVPs",
        icon: <List size={20} color={NEUTRAL.foreground} />,
        onPress: handleViewRsvps,
      },
      {
        id: "open-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={SEMANTIC.success} />,
        onPress: handleOpenInWeb,
      },
      {
        id: "cancel",
        label: "Cancel Event",
        icon: <XCircle size={20} color={SEMANTIC.error} />,
        onPress: handleCancelEvent,
        destructive: true,
      },
    ];
  }, [permissions.canUseAdminActions, handleEditEvent, handleViewRsvps, handleOpenInWeb, handleCancelEvent]);

  // RSVP counts
  const rsvpCounts = useMemo(() => {
    const attending = rsvps.filter((r) => r.status === "attending").length;
    const maybe = rsvps.filter((r) => r.status === "maybe").length;
    const notAttending = rsvps.filter((r) => r.status === "not_attending").length;
    return { attending, maybe, notAttending, total: rsvps.length };
  }, [rsvps]);

  const handleCheckInPress = () => {
    router.push(`/(app)/${orgSlug}/events/check-in?eventId=${eventId}`);
  };

  const isAdmin = permissions.canUseAdminActions;

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={DETAIL_COLORS.success} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error || "Event not found"}</Text>
        <Pressable style={({ pressed }) => [styles.backButtonAlt, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Text style={styles.backButtonAltText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Event Details
              </Text>
            </View>
            {adminMenuItems.length > 0 && (
              <OverflowMenu
                items={adminMenuItems}
                accessibilityLabel="Event options"
                iconColor={APP_CHROME.headerTitle}
              />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{event.title}</Text>

        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Calendar size={18} color={DETAIL_COLORS.mutedText} />
            <Text style={styles.detailText}>
              {formatShortWeekdayDate(event.start_date)} at {formatTime(event.start_date)}
              {event.end_date && ` - ${formatTime(event.end_date)}`}
            </Text>
          </View>

          {event.location && (
            <View style={styles.detailRow}>
              <MapPin size={18} color={DETAIL_COLORS.mutedText} />
              <Text style={styles.detailText}>{event.location}</Text>
            </View>
          )}

          {event.rsvp_count !== undefined && (
            <View style={styles.detailRow}>
              <Users size={18} color={DETAIL_COLORS.mutedText} />
              <Text style={styles.detailText}>{event.rsvp_count} attending</Text>
            </View>
          )}
        </View>

        {event.description && (
          <View style={styles.description}>
            <Text style={styles.descriptionText}>{event.description}</Text>
          </View>
        )}

        {/* RSVP Summary for admins */}
        {isAdmin && rsvps.length > 0 && (
          <Pressable style={({ pressed }) => [styles.rsvpSummary, pressed && { opacity: 0.7 }]} onPress={handleViewRsvps}>
            <Text style={styles.rsvpSummaryTitle}>RSVPs ({rsvpCounts.total})</Text>
            <View style={styles.rsvpCountsRow}>
              <View style={[styles.rsvpCountBadge, { backgroundColor: RSVP_COLORS.going.background }]}>
                <Text style={[styles.rsvpCountText, { color: RSVP_COLORS.going.text }]}>
                  {rsvpCounts.attending} Going
                </Text>
              </View>
              {rsvpCounts.maybe > 0 && (
                <View style={[styles.rsvpCountBadge, { backgroundColor: RSVP_COLORS.maybe.background }]}>
                  <Text style={[styles.rsvpCountText, { color: RSVP_COLORS.maybe.text }]}>
                    {rsvpCounts.maybe} Maybe
                  </Text>
                </View>
              )}
              {rsvpCounts.notAttending > 0 && (
                <View style={[styles.rsvpCountBadge, { backgroundColor: RSVP_COLORS.declined.background }]}>
                  <Text style={[styles.rsvpCountText, { color: RSVP_COLORS.declined.text }]}>
                    {rsvpCounts.notAttending} Can't Go
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.rsvpTapHint}>Tap to view all RSVPs</Text>
          </Pressable>
        )}

        {/* Admin Check-In Button */}
        {isAdmin && (
          <Pressable style={styles.checkInButton} onPress={handleCheckInPress}>
            <UserCheck size={20} color="#ffffff" />
            <Text style={styles.checkInButtonText}>Check In Attendees</Text>
          </Pressable>
        )}

        {!event.user_rsvp_status && (
          <Pressable style={styles.rsvpButton}>
            <Text style={styles.rsvpButtonText}>RSVP</Text>
          </Pressable>
        )}
      </ScrollView>

      {isCancelling && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={DETAIL_COLORS.success} />
        </View>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: DETAIL_COLORS.background,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
    },
    title: {
      ...TYPOGRAPHY.headlineLarge,
      color: DETAIL_COLORS.primaryText,
      marginBottom: SPACING.md,
    },
    details: {
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      gap: SPACING.sm,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    detailText: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.primaryText,
      flex: 1,
    },
    description: {
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
    },
    descriptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.primaryText,
      lineHeight: 24,
    },
    rsvpSummary: {
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: DETAIL_COLORS.border,
    },
    rsvpSummaryTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: DETAIL_COLORS.primaryText,
      marginBottom: SPACING.sm,
    },
    rsvpCountsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    rsvpCountBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.md,
    },
    rsvpCountText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600",
    },
    rsvpTapHint: {
      ...TYPOGRAPHY.caption,
      color: DETAIL_COLORS.mutedText,
    },
    checkInButton: {
      backgroundColor: DETAIL_COLORS.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    checkInButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600",
    },
    rsvpButton: {
      backgroundColor: DETAIL_COLORS.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center",
    },
    rsvpButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600",
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    backButtonAlt: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: DETAIL_COLORS.success,
    },
    backButtonAltText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(255, 255, 255, 0.8)",
      justifyContent: "center",
      alignItems: "center",
    },
  });
