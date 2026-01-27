import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Calendar,
  MapPin,
  Users,
  ChevronLeft,
  UserCheck,
  Edit3,
  XCircle,
  ExternalLink,
  List,
  Check,
  HelpCircle,
  X,
} from "lucide-react-native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import type { Event } from "@/hooks/useEvents";
import { APP_CHROME } from "@/lib/chrome";
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
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const [event, setEvent] = useState<Event | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [userRsvpStatus, setUserRsvpStatus] = useState<RSVPStatus | null>(null);
  const [userRsvpId, setUserRsvpId] = useState<string | null>(null);
  const [isSubmittingRsvp, setIsSubmittingRsvp] = useState(false);

  const handleBack = () => {
    router.back();
  };

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

      // Fetch RSVPs
      const { data: rsvpData } = await supabase
        .from("event_rsvps")
        .select("id, user_id, status, users(name, email)")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (rsvpData) {
        setRsvps(rsvpData as unknown as RSVP[]);

        // Find current user's RSVP
        if (user?.id) {
          const userRsvp = rsvpData.find((r: any) => r.user_id === user.id);
          if (userRsvp) {
            setUserRsvpStatus(userRsvp.status as RSVPStatus);
            setUserRsvpId(userRsvp.id);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventId, orgSlug, user?.id]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // Handle RSVP submission
  const handleRsvp = async (status: RSVPStatus) => {
    if (!user?.id || !eventId || !orgId) {
      Alert.alert("Error", "Unable to submit RSVP. Please try again.");
      return;
    }

    // Optimistically update UI
    const previousStatus = userRsvpStatus;
    setUserRsvpStatus(status);
    setIsSubmittingRsvp(true);

    try {
      // First check if user already has an RSVP for this event
      const { data: existingRsvp } = await supabase
        .from("event_rsvps")
        .select("id")
        .eq("event_id", eventId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingRsvp) {
        // Update existing RSVP
        const { error: updateError } = await supabase
          .from("event_rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);

        if (updateError) throw updateError;
        setUserRsvpId(existingRsvp.id);
      } else {
        // Create new RSVP
        const { data: newRsvp, error: insertError } = await supabase
          .from("event_rsvps")
          .insert({
            event_id: eventId,
            user_id: user.id,
            organization_id: orgId,
            status,
          })
          .select("id")
          .single();

        if (insertError) throw insertError;
        if (newRsvp) {
          setUserRsvpId(newRsvp.id);
        }
      }

      // Refresh RSVPs to get updated counts
      fetchEvent();
    } catch (e) {
      // Revert optimistic update on error
      setUserRsvpStatus(previousStatus);
      Alert.alert("Error", (e as Error).message || "Failed to submit RSVP");
    } finally {
      setIsSubmittingRsvp(false);
    }
  };

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
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Event</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={SEMANTIC.success} />
          </View>
        </View>
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Event</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error || "Event not found"}</Text>
            <Pressable
              onPress={handleBack}
              style={({ pressed }) => [styles.goBackButton, pressed && styles.goBackButtonPressed]}
            >
              <Text style={styles.goBackButtonText}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Event</Text>
            {adminMenuItems.length > 0 ? (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Event options" />
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Event Title */}
          <Text style={styles.title}>{event.title}</Text>

          {/* Event Details Card */}
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Calendar size={18} color={SEMANTIC.success} />
              <Text style={styles.detailText}>
                {formatDate(event.start_date)} at {formatTime(event.start_date)}
                {event.end_date && ` - ${formatTime(event.end_date)}`}
              </Text>
            </View>

            {event.location && (
              <View style={styles.detailRow}>
                <MapPin size={18} color={SEMANTIC.success} />
                <Text style={styles.detailText}>{event.location}</Text>
              </View>
            )}

            <View style={styles.detailRow}>
              <Users size={18} color={SEMANTIC.success} />
              <Text style={styles.detailText}>{rsvpCounts.attending} attending</Text>
            </View>
          </View>

          {/* Description */}
          {event.description && (
            <View style={styles.descriptionCard}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.descriptionText}>{event.description}</Text>
            </View>
          )}

          {/* RSVP Section */}
          <View style={styles.rsvpSection}>
            <Text style={styles.sectionTitle}>Your RSVP</Text>
            {userRsvpStatus && (
              <Text style={styles.currentRsvpText}>
                Current status: {userRsvpStatus === "attending" ? "Going" : userRsvpStatus === "maybe" ? "Maybe" : "Can't Go"}
              </Text>
            )}
            <View style={styles.rsvpButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.rsvpOptionButton,
                  userRsvpStatus === "attending" && styles.rsvpOptionButtonSelected,
                  { backgroundColor: userRsvpStatus === "attending" ? RSVP_COLORS.going.background : NEUTRAL.background },
                  pressed && styles.rsvpOptionButtonPressed,
                ]}
                onPress={() => handleRsvp("attending")}
                disabled={isSubmittingRsvp}
              >
                <Check size={20} color={userRsvpStatus === "attending" ? RSVP_COLORS.going.text : NEUTRAL.muted} />
                <Text style={[
                  styles.rsvpOptionText,
                  { color: userRsvpStatus === "attending" ? RSVP_COLORS.going.text : NEUTRAL.foreground }
                ]}>
                  Going
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.rsvpOptionButton,
                  userRsvpStatus === "maybe" && styles.rsvpOptionButtonSelected,
                  { backgroundColor: userRsvpStatus === "maybe" ? RSVP_COLORS.maybe.background : NEUTRAL.background },
                  pressed && styles.rsvpOptionButtonPressed,
                ]}
                onPress={() => handleRsvp("maybe")}
                disabled={isSubmittingRsvp}
              >
                <HelpCircle size={20} color={userRsvpStatus === "maybe" ? RSVP_COLORS.maybe.text : NEUTRAL.muted} />
                <Text style={[
                  styles.rsvpOptionText,
                  { color: userRsvpStatus === "maybe" ? RSVP_COLORS.maybe.text : NEUTRAL.foreground }
                ]}>
                  Maybe
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.rsvpOptionButton,
                  userRsvpStatus === "not_attending" && styles.rsvpOptionButtonSelected,
                  { backgroundColor: userRsvpStatus === "not_attending" ? RSVP_COLORS.declined.background : NEUTRAL.background },
                  pressed && styles.rsvpOptionButtonPressed,
                ]}
                onPress={() => handleRsvp("not_attending")}
                disabled={isSubmittingRsvp}
              >
                <X size={20} color={userRsvpStatus === "not_attending" ? RSVP_COLORS.declined.text : NEUTRAL.muted} />
                <Text style={[
                  styles.rsvpOptionText,
                  { color: userRsvpStatus === "not_attending" ? RSVP_COLORS.declined.text : NEUTRAL.foreground }
                ]}>
                  Can't Go
                </Text>
              </Pressable>
            </View>
            {isSubmittingRsvp && (
              <ActivityIndicator size="small" color={SEMANTIC.success} style={styles.rsvpLoader} />
            )}
          </View>

          {/* RSVP Summary for admins */}
          {isAdmin && rsvps.length > 0 && (
            <Pressable
              style={({ pressed }) => [styles.rsvpSummary, pressed && styles.rsvpSummaryPressed]}
              onPress={handleViewRsvps}
            >
              <Text style={styles.sectionTitle}>All RSVPs ({rsvpCounts.total})</Text>
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
            <Pressable
              style={({ pressed }) => [styles.checkInButton, pressed && styles.checkInButtonPressed]}
              onPress={handleCheckInPress}
            >
              <UserCheck size={20} color="#ffffff" />
              <Text style={styles.checkInButtonText}>Check In Attendees</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>

      {isCancelling && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={SEMANTIC.success} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {},
  headerSafeArea: {},
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
  },
  title: {
    ...TYPOGRAPHY.headlineLarge,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  detailsCard: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    gap: SPACING.sm,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  detailText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    flex: 1,
  },
  descriptionCard: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
  },
  descriptionText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    lineHeight: 24,
  },
  rsvpSection: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  currentRsvpText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    marginBottom: SPACING.sm,
  },
  rsvpButtonsRow: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  rsvpOptionButton: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    gap: SPACING.xs,
  },
  rsvpOptionButtonSelected: {
    borderWidth: 2,
  },
  rsvpOptionButtonPressed: {
    opacity: 0.7,
  },
  rsvpOptionText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: "600",
  },
  rsvpLoader: {
    marginTop: SPACING.sm,
  },
  rsvpSummary: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  rsvpSummaryPressed: {
    opacity: 0.7,
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
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  checkInButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
  },
  checkInButtonPressed: {
    opacity: 0.9,
  },
  checkInButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
    fontWeight: "600",
  },
  errorText: {
    ...TYPOGRAPHY.bodyMedium,
    color: SEMANTIC.error,
    textAlign: "center",
    marginBottom: SPACING.md,
  },
  goBackButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: SEMANTIC.success,
  },
  goBackButtonPressed: {
    opacity: 0.9,
  },
  goBackButtonText: {
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
