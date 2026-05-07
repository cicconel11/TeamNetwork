import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Calendar, MapPin, Users, ChevronLeft, UserCheck, Edit3, XCircle, ExternalLink, List, Share2, CalendarPlus, QrCode } from "lucide-react-native";
import { shareEvent } from "@/lib/share";
import { syncEventToDevice } from "@/lib/native-calendar";
import { useDevicePermission } from "@/lib/device-permissions";
import * as Linking from "expo-linking";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useNetwork } from "@/contexts/NetworkContext";
import { useRsvp } from "@/hooks/useRsvp";
import { ErrorState } from "@/components/ui";
import type { Event } from "@/hooks/useEvents";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, RSVP_COLORS } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatShortWeekdayDate, formatTime } from "@/lib/date-format";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import * as sentry from "@/lib/analytics/sentry";
import type { RsvpStatus } from "@teammeet/core";
import { useAuth } from "@/hooks/useAuth";


type RSVPStatus = RsvpStatus;

function rsvpButtonLabel(status: RsvpStatus): string {
  switch (status) {
    case "attending":
      return "Going";
    case "maybe":
      return "Maybe";
    case "not_attending":
      return "Can't Go";
  }
}

function sentryCaptureRsvpRefetchError(err: unknown): void {
  sentry.captureException(err as Error, {
    context: "EventDetailScreen.fetchRsvps",
  });
}

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
  const { orgId, orgSlug, orgName } = useOrg();
  const calendarPermission = useDevicePermission("calendar");
  const router = useRouter();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    centered: {
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
      color: n.foreground,
      marginBottom: SPACING.md,
    },
    details: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      gap: SPACING.sm,
    },
    detailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    detailText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      flex: 1,
    },
    description: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
    },
    descriptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      lineHeight: 24,
    },
    rsvpSummary: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.md,
      borderWidth: 1,
      borderColor: n.border,
    },
    rsvpSummaryTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    rsvpCountsRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
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
      fontWeight: "600" as const,
    },
    rsvpTapHint: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    checkInButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    checkInButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    rsvpButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    rsvpButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    selfScanRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      paddingVertical: SPACING.md,
      marginBottom: SPACING.md,
    },
    selfScanText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    rsvpError: {
      ...TYPOGRAPHY.caption,
      color: s.error,
      marginTop: SPACING.xs,
    },
    loadingOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: n.surface + "cc",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
  }));
  const [event, setEvent] = useState<Event | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const { user } = useAuth();

  const rsvp = useRsvp(eventId, orgId, {
    initialStatus: event?.user_rsvp_status ?? null,
  });

  const fetchRsvps = useCallback(async () => {
    if (!eventId) return;
    const { data: rsvpData, error: rsvpError } = await supabase
      .from("event_rsvps")
      .select("id, user_id, status, users(name, email)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (rsvpError) {
      sentryCaptureRsvpRefetchError(rsvpError);
      return;
    }
    if (rsvpData) {
      setRsvps(rsvpData as unknown as RSVP[]);
    }
  }, [eventId]);

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

      await fetchRsvps();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventId, orgSlug, fetchRsvps]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Realtime: keep admin RSVP counts live during a check-in session.
  // Mirrors the channel pattern in `useEventRSVPs.ts`.
  useEffect(() => {
    if (!eventId) return;
    const channel = createPostgresChangesChannel(`event_detail_rsvps:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_rsvps",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void fetchRsvps();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchRsvps]);

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
              track("event_cancelled", { event_id: eventId, org_id: orgId });
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
    const webUrl = getWebPath(orgSlug, `events/${eventId}`);
    Linking.openURL(webUrl);
  }, [orgSlug, eventId]);

  // Admin menu items
  const handleShareEvent = useCallback(() => {
    if (!event) return;
    void shareEvent({ id: event.id, title: event.title, orgSlug });
  }, [event, orgSlug]);

  const handleAddToCalendar = useCallback(async () => {
    if (!event || !orgId) return;
    if (calendarPermission.status !== "granted") {
      const next = await calendarPermission.request();
      if (next !== "granted") {
        if (calendarPermission.status === "denied" && !calendarPermission.canAskAgain) {
          Alert.alert(
            "Calendar access needed",
            "Open Settings to allow TeamMeet to add events to your calendar.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => void calendarPermission.openSettings() },
            ]
          );
        }
        return;
      }
    }
    try {
      await syncEventToDevice({
        orgId,
        orgName: orgName ?? "TeamMeet",
        event,
      });
      Alert.alert("Added to calendar", `${event.title} is now in your device calendar.`);
    } catch (err) {
      Alert.alert("Couldn't add", err instanceof Error ? err.message : "Failed to add event.");
    }
  }, [event, orgId, orgName, calendarPermission]);

  const handleShowEventQr = useCallback(() => {
    router.push(`/(app)/${orgSlug}/events/${eventId}/qr`);
  }, [router, orgSlug, eventId]);

  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    const shareItem: OverflowMenuItem = {
      id: "share",
      label: "Share Event",
      icon: <Share2 size={20} color={neutral.foreground} />,
      onPress: handleShareEvent,
    };
    const calendarItem: OverflowMenuItem = {
      id: "add-to-calendar",
      label: "Add to Calendar",
      icon: <CalendarPlus size={20} color={neutral.foreground} />,
      onPress: handleAddToCalendar,
    };
    if (!permissions.canUseAdminActions) return [shareItem, calendarItem];

    return [
      shareItem,
      calendarItem,
      {
        id: "edit",
        label: "Edit Event",
        icon: <Edit3 size={20} color={neutral.foreground} />,
        onPress: handleEditEvent,
      },
      {
        id: "view-rsvps",
        label: "View RSVPs",
        icon: <List size={20} color={neutral.foreground} />,
        onPress: handleViewRsvps,
      },
      {
        id: "event-qr",
        label: "Show Event QR",
        icon: <QrCode size={20} color={neutral.foreground} />,
        onPress: handleShowEventQr,
      },
      {
        id: "open-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={semantic.success} />,
        onPress: handleOpenInWeb,
      },
      {
        id: "cancel",
        label: "Cancel Event",
        icon: <XCircle size={20} color={semantic.error} />,
        onPress: handleCancelEvent,
        destructive: true,
      },
    ];
  }, [
    permissions.canUseAdminActions,
    handleEditEvent,
    handleViewRsvps,
    handleShowEventQr,
    handleOpenInWeb,
    handleCancelEvent,
    handleShareEvent,
    handleAddToCalendar,
    neutral,
    semantic,
  ]);

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
        <ActivityIndicator size="large" color={semantic.success} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.container}>
        <ErrorState
          onRetry={fetchEvent}
          title={error ? "Unable to load event" : "Event not found"}
          isOffline={isOffline}
        />
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
            <Calendar size={18} color={neutral.muted} />
            <Text style={styles.detailText}>
              {formatShortWeekdayDate(event.start_date)} at {formatTime(event.start_date)}
              {event.end_date && ` - ${formatTime(event.end_date)}`}
            </Text>
          </View>

          {event.location && (
            <View style={styles.detailRow}>
              <MapPin size={18} color={neutral.muted} />
              <Text style={styles.detailText}>{event.location}</Text>
            </View>
          )}

          {event.rsvp_count !== undefined && (
            <View style={styles.detailRow}>
              <Users size={18} color={neutral.muted} />
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
              <View style={[styles.rsvpCountBadge, { backgroundColor: RSVP_COLORS.attending.background }]}>
                <Text style={[styles.rsvpCountText, { color: RSVP_COLORS.attending.text }]}>
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
                <View style={[styles.rsvpCountBadge, { backgroundColor: RSVP_COLORS.not_attending.background }]}>
                  <Text style={[styles.rsvpCountText, { color: RSVP_COLORS.not_attending.text }]}>
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

        {!isAdmin && (
          <Pressable
            style={({ pressed }) => [
              styles.rsvpButton,
              (rsvp.saving || pressed) && { opacity: 0.7 },
            ]}
            onPress={rsvp.promptRsvp}
            disabled={rsvp.saving}
            accessibilityRole="button"
            accessibilityLabel={
              rsvp.status
                ? `Update RSVP, currently ${rsvpButtonLabel(rsvp.status)}`
                : "RSVP to event"
            }
          >
            <Text style={styles.rsvpButtonText}>
              {rsvp.saving
                ? "Saving…"
                : rsvp.status
                  ? `RSVP: ${rsvpButtonLabel(rsvp.status)}`
                  : "RSVP"}
            </Text>
          </Pressable>
        )}

        {user && !isAdmin && (
          <Pressable
            style={({ pressed }) => [styles.selfScanRow, pressed && { opacity: 0.85 }]}
            onPress={() =>
              router.push(`/(app)/${orgSlug}/events/${eventId}/scan?mode=self` as never)
            }
          >
            <QrCode size={22} color={semantic.success} />
            <Text style={styles.selfScanText}>Scan event QR to check in</Text>
          </Pressable>
        )}
      </ScrollView>

      {isCancelling && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={semantic.success} />
        </View>
      )}
    </View>
  );
}

