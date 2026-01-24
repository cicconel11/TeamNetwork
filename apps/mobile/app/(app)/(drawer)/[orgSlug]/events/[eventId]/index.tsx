import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Calendar, MapPin, Users, ArrowLeft, UserCheck, Edit3, XCircle, ExternalLink, List } from "lucide-react-native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import type { Event } from "@/hooks/useEvents";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";
import { SEMANTIC, NEUTRAL, SPACING, RADIUS, RSVP_COLORS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";

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
  const { colors } = useOrgTheme();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const handleCheckInPress = () => {
    router.push(`/(app)/${orgSlug}/events/check-in?eventId=${eventId}`);
  };

  const isAdmin = permissions.canUseAdminActions;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "Event not found"}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header with back button and admin menu */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={20} color={colors.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        {adminMenuItems.length > 0 && (
          <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
        )}
      </View>

      <Text style={styles.title}>{event.title}</Text>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Calendar size={18} color={colors.muted} />
          <Text style={styles.detailText}>
            {formatDate(event.start_date)} at {formatTime(event.start_date)}
            {event.end_date && ` - ${formatTime(event.end_date)}`}
          </Text>
        </View>

        {event.location && (
          <View style={styles.detailRow}>
            <MapPin size={18} color={colors.muted} />
            <Text style={styles.detailText}>{event.location}</Text>
          </View>
        )}

        {event.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={18} color={colors.muted} />
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
        <TouchableOpacity style={styles.rsvpSummary} onPress={handleViewRsvps} activeOpacity={0.7}>
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
        </TouchableOpacity>
      )}

      {/* Admin Check-In Button */}
      {isAdmin && (
        <TouchableOpacity style={styles.checkInButton} onPress={handleCheckInPress}>
          <UserCheck size={20} color="#ffffff" />
          <Text style={styles.checkInButtonText}>Check In Attendees</Text>
        </TouchableOpacity>
      )}

      {!event.user_rsvp_status && (
        <TouchableOpacity style={styles.rsvpButton}>
          <Text style={styles.rsvpButtonText}>RSVP</Text>
        </TouchableOpacity>
      )}

      {isCancelling && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: SPACING.md,
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    backButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: colors.primary,
    },
    title: {
      ...TYPOGRAPHY.headlineLarge,
      color: colors.foreground,
      marginBottom: SPACING.md,
    },
    details: {
      backgroundColor: colors.card,
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
      color: colors.foreground,
      flex: 1,
    },
    description: {
      backgroundColor: colors.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
    },
    descriptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: colors.foreground,
      lineHeight: 24,
    },
    rsvpSummary: {
      backgroundColor: colors.card,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rsvpSummaryTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: colors.foreground,
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
      color: colors.muted,
    },
    checkInButton: {
      backgroundColor: SEMANTIC.success,
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
      backgroundColor: colors.primary,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center",
    },
    rsvpButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: colors.primaryForeground,
      fontWeight: "600",
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: colors.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(255, 255, 255, 0.8)",
      justifyContent: "center",
      alignItems: "center",
    },
  });
