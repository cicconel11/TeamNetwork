import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowLeft } from "lucide-react-native";
import { QRScanner } from "@/components/QRScanner";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEventRSVPs } from "@/hooks/useEventRSVPs";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { parseTeammeetUrl } from "@/lib/deep-link";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING } from "@/lib/design-tokens";

type Toast = { kind: "ok" | "error" | "info"; text: string } | null;

export default function ScanCheckInScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { orgSlug } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const { rsvps, loading, checkInAttendee, findRsvpByUserId, attendingCount } =
    useEventRSVPs(eventId);

  const [toast, setToast] = useState<Toast>(null);

  const showToast = useCallback((next: NonNullable<Toast>) => {
    setToast(next);
    setTimeout(() => setToast(null), 1800);
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
    [eventId, orgSlug, findRsvpByUserId, checkInAttendee, showToast]
  );

  if (!roleLoading && !isAdmin) {
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
