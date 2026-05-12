import * as Haptics from "expo-haptics";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { QRScanner } from "@/components/QRScanner";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEventRSVPs } from "@/hooks/useEventRSVPs";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { parseTeammeetUrl } from "@/lib/deep-link";
import { captureCurrentCoords } from "@/lib/event-location";
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

  // Safe-area inset with a defensive iOS minimum so the Done button never
  // lands behind the status-bar clock when SafeAreaProvider isn't mounted.
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === "ios" ? 50 : 24);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else if (orgSlug && eventId) {
      // Modal presented without a parent in the stack (deep link / cold
      // start straight into scan). Replace with the event detail so Done
      // isn't a dead button.
      router.replace(`/(app)/${orgSlug}/events/${eventId}` as never);
    } else {
      router.replace("/" as never);
    }
  }, [router, orgSlug, eventId]);

  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [checkInMode, setCheckInMode] = useState<"qr" | "rsvp">("qr");
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEventMeta() {
      if (!eventId) return;
      const { data } = await supabase
        .from("events")
        .select("geofence_enabled, check_in_mode")
        .eq("id", eventId)
        .maybeSingle();
      if (!cancelled) {
        setGeofenceEnabled(!!data?.geofence_enabled);
        const mode = (data as { check_in_mode?: "qr" | "rsvp" } | null)?.check_in_mode;
        if (mode === "rsvp" || mode === "qr") setCheckInMode(mode);
      }
    }
    void loadEventMeta();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const showToast = useCallback((next: NonNullable<Toast>) => {
    setToast(next);
    setTimeout(() => setToast(null), 2400);
  }, []);

  const completeSelfCheckIn = useCallback(
    async (
      coords: { latitude: number; longitude: number } | null,
    ): Promise<boolean> => {
      if (!eventId) return false;
      const { data, error: rpcError } = await supabase.rpc("self_check_in_event", {
        p_event_id: eventId,
        p_lat: coords?.latitude ?? undefined,
        p_lng: coords?.longitude ?? undefined,
        // venue_confirmed retained for back-compat with the old RPC signature;
        // ignored when p_lat/p_lng are present.
        p_venue_confirmed: coords != null,
      });

      if (rpcError) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ kind: "error", text: rpcError.message });
        return false;
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
        return false;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ kind: "ok", text: "You’re checked in" });
      return true;
    },
    [eventId, showToast]
  );

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

        if (geofenceEnabled) {
          showToast({ kind: "info", text: "Reading your location…" });
          const locResult = await captureCurrentCoords();
          if (!locResult.ok) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            showToast({
              kind: "error",
              text:
                locResult.reason === "denied"
                  ? "Allow Location in Settings → TeamNetwork to check in."
                  : locResult.message,
            });
            return true;
          }
          await completeSelfCheckIn(locResult.coords);
          return true;
        }

        await completeSelfCheckIn(null);
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

      const result = await checkInAttendee(rsvp.id);
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
      completeSelfCheckIn,
    ]
  );

  if (!roleLoading && mode === "admin" && !isAdmin) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: neutral.background, paddingTop: topInset },
        ]}
      >
        <Text style={[styles.title, { color: neutral.foreground }]}>Admins only</Text>
        <Text style={[styles.body, { color: neutral.muted }]}>
          Only admins can scan member QR codes for check-in.
        </Text>
      </View>
    );
  }

  if (checkInMode === "rsvp") {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: neutral.background, paddingTop: topInset },
        ]}
      >
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.backButton,
            { alignSelf: "flex-start", margin: SPACING.md },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ArrowLeft size={24} color={neutral.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: neutral.foreground, textAlign: "center" }]}>
          No QR for this event
        </Text>
        <Text
          style={[
            styles.body,
            { color: neutral.muted, textAlign: "center", marginHorizontal: SPACING.lg },
          ]}
        >
          This event uses simple RSVP — attendees just confirm they’re coming, no QR check-in
          needed.
        </Text>
      </View>
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
                ? "Scan event QR — confirm venue in Maps when asked"
                : "Scan event QR to check in"
              : `${attendingCount} attending · ${rsvps.length} total RSVPs`
        }
      />
      <View
        pointerEvents="box-none"
        style={[styles.headerOverlay, { paddingTop: topInset }]}
      >
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.backButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel="Done — close scanner"
        >
          <ArrowLeft size={22} color="#fff" />
          <Text style={styles.backText}>Done</Text>
        </Pressable>
      </View>
      {toast && (
        <View pointerEvents="none" style={[styles.toast, { backgroundColor: toastBg }]}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
      {__DEV__ && eventId && mode === "self" ? (
        <Pressable
          onPress={async () => {
            // Always exercise the self+geofence path — that's what's actually
            // hard to reach on the sim (no camera). Independent of `mode`.
            if (geofenceEnabled) {
              showToast({ kind: "info", text: "Reading your location…" });
              const locResult = await captureCurrentCoords();
              if (!locResult.ok) {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                showToast({
                  kind: "error",
                  text:
                    locResult.reason === "denied"
                      ? "Allow Location in Settings → TeamNetwork to check in."
                      : locResult.message,
                });
                return;
              }
              await completeSelfCheckIn(locResult.coords);
            } else {
              await completeSelfCheckIn(null);
            }
          }}
          style={({ pressed }) => [styles.simulateButton, pressed && { opacity: 0.7 }]}
          accessibilityLabel="Dev: simulate successful self check-in"
        >
          <Text style={styles.simulateButtonText}>Dev: simulate scan (self)</Text>
        </Pressable>
      ) : null}
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
    // paddingTop applied inline from useSafeAreaInsets so Done is always
    // below the status bar / clock on every device.
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
  simulateButton: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
    backgroundColor: "rgba(37, 99, 235, 0.95)",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: 999,
  },
  simulateButtonText: { ...TYPOGRAPHY.labelMedium, color: "#fff" },
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
