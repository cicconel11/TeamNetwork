import * as Haptics from "expo-haptics";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { QRScanner } from "@/components/QRScanner";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEventRSVPs } from "@/hooks/useEventRSVPs";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { parseTeammeetUrl } from "@/lib/deep-link";
import { getDeviceCoords } from "@/lib/event-location";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING } from "@/lib/design-tokens";
import { supabase } from "@/lib/supabase";

type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

type ScanMode = "admin" | "self";

export default function ScanCheckInScreen() {
  const { eventId, mode: modeParam } = useLocalSearchParams<{
    eventId: string;
    mode?: string;
  }>();
  const router = useRouter();
  const { orgSlug } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { rsvps, loading, checkInAttendee, findRsvpByUserId, attendingCount } =
    useEventRSVPs(eventId);

  const mode: ScanMode = modeParam === "self" ? "self" : "admin";

  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGeo() {
      if (!eventId) return;
      const { data } = await supabase
        .from("events")
        .select("geofence_enabled")
        .eq("id", eventId)
        .maybeSingle();
      if (!cancelled) {
        setGeofenceEnabled(!!data?.geofence_enabled);
      }
    }
    void loadGeo();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const showToast = useCallback((next: NonNullable<Toast>) => {
    setToast(next);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const handleScan = useCallback(
    async (raw: string): Promise<boolean> => {
      const intent = parseTeammeetUrl(raw);

      if (intent.kind !== "event-checkin") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({ kind: "error", text: "Not a check-in QR code" });
        return true;
      }

      if (intent.eventId !== eventId) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({ kind: "error", text: "QR is for a different event" });
        return true;
      }
      if (intent.orgSlug !== orgSlug) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({ kind: "error", text: "QR is for a different organization" });
        return true;
      }

      if (mode === "self") {
        if (intent.userId) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast({ kind: "error", text: "Use the event check-in QR code" });
          return true;
        }

        let pLat: number | undefined;
        let pLng: number | undefined;
        if (geofenceEnabled) {
          const loc = await getDeviceCoords();
          if (!loc.ok) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            showToast({ kind: "error", text: loc.error });
            return true;
          }
          pLat = loc.coords.latitude;
          pLng = loc.coords.longitude;
        }

        const { data, error: rpcError } = await supabase.rpc("self_check_in_event", {
          p_event_id: eventId,
          p_lat: pLat,
          p_lng: pLng,
        });

        if (rpcError) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ kind: "error", text: rpcError.message });
          return true;
        }

        const payload =
          data && typeof data === "object" && "success" in (data as object)
            ? (data as { success?: boolean; error?: string })
            : null;

        if (!payload || payload.success !== true) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({
            kind: "error",
            text: typeof payload?.error === "string" ? payload.error : "Check-in failed",
          });
          return true;
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ kind: "ok", text: "You’re checked in" });
        return true;
      }

      if (!intent.userId) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({ kind: "error", text: "Scan a member QR from this event" });
        return true;
      }

      const rsvp = findRsvpByUserId(intent.userId);
      if (!rsvp) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({ kind: "error", text: "Member is not on the RSVP list" });
        return true;
      }
      // Only members who said they're attending should check in. We surface
      // a clear message instead of silently checking in a `maybe` /
      // `not_attending` row, so the admin can decide what to do.
      if (rsvp.status !== "attending") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({
          kind: "error",
          text: `${rsvp.user?.name ?? "Member"} is not on the attending list`,
        });
        return true;
      }
      if (rsvp.checked_in_at) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast({
          kind: "info",
          text: `${rsvp.user?.name ?? "Member"} already checked in`,
        });
        return true;
      }

      let coords: { latitude: number; longitude: number } | undefined;
      if (geofenceEnabled) {
        const loc = await getDeviceCoords();
        if (!loc.ok) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showToast({ kind: "error", text: loc.error });
          return true;
        }
        coords = loc.coords;
      }

      const result = await checkInAttendee(rsvp.id, coords);
      if (result.success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({
          kind: "ok",
          text: `Checked in ${rsvp.user?.name ?? "member"}`,
        });
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ kind: "error", text: result.error ?? "Check-in failed" });
      }
      return true;
    },
    [
      mode,
      eventId,
      orgSlug,
      geofenceEnabled,
      findRsvpByUserId,
      checkInAttendee,
      showToast,
    ]
  );

  if (!roleLoading && mode === "admin" && !isAdmin) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: neutral.background }]}>
        <Text style={[styles.title, { color: neutral.foreground }]}>Admins only</Text>
        <Text style={[styles.body, { color: neutral.muted }]}>
          Only admins can scan member QR codes for check-in.
        </Text>
      </SafeAreaView>
    );
  }

  const toastBg =
    toast?.kind === "ok"
      ? semantic.success
      : toast?.kind === "error"
      ? semantic.error
      : semantic.info;

  return (
    <View style={styles.container}>
      <QRScanner
        onScan={handleScan}
        hint={
          loading
            ? "Loading RSVPs…"
            : mode === "self"
              ? geofenceEnabled
                ? "Scan event QR (location verified at venue)"
                : "Scan event QR to check in"
              : `${attendingCount} attending · ${rsvps.length} total RSVPs`
        }
      />
      <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.headerOverlay}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          hitSlop={12}
        >
          <ArrowLeft size={22} color="#fff" />
          <Text style={styles.backText}>Done</Text>
        </Pressable>
      </SafeAreaView>
      {toast && (
        <View pointerEvents="none" style={[styles.toast, { backgroundColor: toastBg }]}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  backText: { ...TYPOGRAPHY.labelMedium, color: "#fff" },
  toast: {
    position: "absolute",
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.xl,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: 12,
  },
  toastText: { ...TYPOGRAPHY.labelLarge, color: "#fff", textAlign: "center" },
  title: { ...TYPOGRAPHY.titleLarge, padding: SPACING.lg, textAlign: "center" },
  body: { ...TYPOGRAPHY.bodyMedium, paddingHorizontal: SPACING.lg, textAlign: "center" },
});
