import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Linkedin, RefreshCw } from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useLinkedInSync } from "@/hooks/useLinkedInSync";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { showToast } from "@/components/ui/Toast";

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "Never";
  }
}

/**
 * Profile-screen card: one async "Sync LinkedIn" action + status badge. Relies
 * on the LinkedIn URL the user saves via the profile form above; enrichment
 * runs in the background and the badge polls to enriched/failed.
 */
export function LinkedInSyncCard() {
  const { status, loading, syncing, sync } = useLinkedInSync();
  const [starting, setStarting] = useState(false);

  const styles = useThemedStyles((n, s) => ({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    headerRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    titleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    title: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    body: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    meta: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    badge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 3,
      borderRadius: RADIUS.sm,
    },
    badgeText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
    },
    badgeSyncing: { backgroundColor: s.infoLight },
    badgeSyncingText: { color: s.info },
    badgeSynced: { backgroundColor: s.successLight },
    badgeSyncedText: { color: s.success },
    badgeFailed: { backgroundColor: s.errorLight },
    badgeFailedText: { color: s.error },
    button: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: s.info,
      alignSelf: "flex-start" as const,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
  }));

  const handleSync = useCallback(async () => {
    setStarting(true);
    try {
      const result = await sync();
      showToast(result.message, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to start LinkedIn sync", "error");
    } finally {
      setStarting(false);
    }
  }, [sync]);

  if (loading && !status) return null;
  if (!status) return null;

  const hasUrl = !!status.linkedInUrl;
  const quotaExhausted = status.resyncRemaining <= 0;
  const resyncAllowed = status.resyncEnabled || status.resyncIsAdmin;
  const busy = starting || syncing;
  const disabled =
    busy || !status.enrichmentConfigured || !hasUrl || !resyncAllowed || quotaExhausted;

  const renderBadge = () => {
    switch (status.enrichmentStatus) {
      case "syncing":
      case "pending":
        return (
          <View style={[styles.badge, styles.badgeSyncing]}>
            <Text style={[styles.badgeText, styles.badgeSyncingText]}>Syncing…</Text>
          </View>
        );
      case "enriched":
        return (
          <View style={[styles.badge, styles.badgeSynced]}>
            <Text style={[styles.badgeText, styles.badgeSyncedText]}>Synced</Text>
          </View>
        );
      case "failed":
        return (
          <View style={[styles.badge, styles.badgeFailed]}>
            <Text style={[styles.badgeText, styles.badgeFailedText]}>Sync failed</Text>
          </View>
        );
      default:
        return null;
    }
  };

  const helper = !status.enrichmentConfigured
    ? "LinkedIn sync is not available right now."
    : !hasUrl
      ? "Add your LinkedIn URL above and save it first."
      : !resyncAllowed
        ? "LinkedIn sync is managed by your organization."
        : quotaExhausted
          ? "Sync limit reached — resets next month."
          : `${status.resyncRemaining} of ${status.resyncMaxPerMonth} syncs remaining this month.`;

  return (
    <Animated.View entering={FadeInDown.duration(250).delay(120)} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Linkedin size={18} color="#0a66c2" />
          <Text style={styles.title}>LinkedIn Sync</Text>
        </View>
        {renderBadge()}
      </View>

      <Text style={styles.body}>
        Pull your headline, company, education, skills, and more from your public LinkedIn
        profile. Runs in the background — your profile updates when it finishes.
      </Text>

      <Pressable
        onPress={handleSync}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Sync LinkedIn"
        style={({ pressed }) => [
          styles.button,
          disabled && styles.buttonDisabled,
          pressed && !disabled && { opacity: 0.8 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <RefreshCw size={16} color="#ffffff" />
        )}
        <Text style={styles.buttonText}>{busy ? "Syncing…" : "Sync LinkedIn"}</Text>
      </Pressable>

      <Text style={styles.meta}>{helper}</Text>
      {status.lastSyncAt && (
        <Text style={styles.meta}>Last synced {formatLastSync(status.lastSyncAt)}</Text>
      )}
      {status.enrichmentStatus === "failed" && status.syncError && (
        <Text style={styles.errorText}>{status.syncError}</Text>
      )}
    </Animated.View>
  );
}
