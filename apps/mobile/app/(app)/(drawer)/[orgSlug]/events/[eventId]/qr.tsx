import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Calendar, ChevronLeft, MapPin, Share2 } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useNetwork } from "@/contexts/NetworkContext";
import { ErrorState } from "@/components/ui";
import type { Event } from "@/hooks/useEvents";
import { buildEventSelfCheckInDeepLink } from "@/lib/event-check-in-link";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatShortWeekdayDate, formatTime } from "@/lib/date-format";
import { SafeQRCode } from "@/components/SafeQRCode";

export default function EventQrScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgSlug, orgId } = useOrg();
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
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
    },
    title: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      marginBottom: SPACING.md,
    },
    detailCard: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.lg,
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
    hint: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginBottom: SPACING.md,
      textAlign: "center" as const,
    },
    qrWrap: {
      alignItems: "center" as const,
      marginBottom: SPACING.lg,
    },
    shareButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
    },
    shareText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    linkBackText: {
      ...TYPOGRAPHY.labelLarge,
      marginTop: SPACING.md,
      padding: SPACING.sm,
    },
    deniedTitle: {
      ...TYPOGRAPHY.titleMedium,
    },
    deniedBody: {
      ...TYPOGRAPHY.bodyMedium,
      marginTop: SPACING.sm,
    },
  }));

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvent = useCallback(async () => {
    if (!eventId || !orgId) return;
    try {
      setLoading(true);
      const { data, error: qErr } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .single();

      if (qErr) throw qErr;
      setEvent(data as Event);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [eventId, orgId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const qrValue =
    eventId && orgSlug ? buildEventSelfCheckInDeepLink(eventId, orgSlug) : "";

  const handleShare = useCallback(async () => {
    if (!qrValue || !event) return;
    try {
      await Share.share({
        message: `${event.title}: check in with TeamMeet.\n${qrValue}`,
      });
    } catch {
      /* user cancelled */
    }
  }, [qrValue, event]);

  const isAllowed = permissions.canUseAdminActions;

  if (!isAllowed && !loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={[styles.deniedTitle, { color: neutral.foreground }]}>
          Admins only
        </Text>
        <Text style={[styles.deniedBody, { color: neutral.muted, textAlign: "center" }]}>
          Only event admins can display the venue check-in QR.
        </Text>
        <Pressable onPress={() => router.back()}>
          <Text style={[styles.linkBackText, { color: semantic.success }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

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
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]}>
          <View style={styles.navHeader}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            >
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Event QR
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} numberOfLines={3}>
          {event.title}
        </Text>

        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Calendar size={18} color={neutral.muted} />
            <Text style={styles.detailText}>
              {formatShortWeekdayDate(event.start_date)} at {formatTime(event.start_date)}
            </Text>
          </View>
          {event.location ? (
            <View style={styles.detailRow}>
              <MapPin size={18} color={neutral.muted} />
              <Text style={styles.detailText}>{event.location}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hint}>
          Members scan this code in the TeamMeet app to RSVP as going and check in
          {event.geofence_enabled ? " when they are at the venue." : "."}
        </Text>

        <View style={styles.qrWrap}>
          <SafeQRCode value={qrValue} size={280} backgroundColor="#ffffff" />
        </View>

        <Pressable
          style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.9 }]}
          onPress={handleShare}
        >
          <Share2 size={20} color="#fff" />
          <Text style={styles.shareText}>Share QR link</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
