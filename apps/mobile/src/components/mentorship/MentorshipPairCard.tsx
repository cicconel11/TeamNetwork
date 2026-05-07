import React, { useState } from "react";
import { View, Text, Pressable, Alert, StyleSheet } from "react-native";
import { Trash2, ChevronRight } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { normalizeMentorshipStatus, isUserInMentorshipPair } from "@teammeet/core";
import { canCreateMentorshipLog } from "@/lib/mentorship";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { formatDefaultDateFromString } from "@/lib/date-format";
import { MentorshipLogForm } from "./MentorshipLogForm";
import type { MentorshipLog, MentorshipPair } from "@teammeet/types";

export function MentorshipPairCard({
  pair,
  mentorLabel,
  menteeLabel,
  logs,
  isAdmin,
  viewerRole,
  orgId,
  userId,
  userLabel,
  onRefresh,
  onArchive,
  onOpenPair,
}: {
  pair: MentorshipPair;
  mentorLabel: string;
  menteeLabel: string;
  logs: MentorshipLog[];
  isAdmin: boolean;
  viewerRole: string | null;
  orgId: string;
  userId: string | null;
  userLabel: (id: string) => string;
  onRefresh: () => void;
  onArchive: (pairId: string) => void;
  onOpenPair?: (pairId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    Alert.alert(
      "Archive mentorship pair?",
      "This will hide the pair from active views while preserving the activity history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            setError(null);

            // Soft-delete associated logs first (non-blocking — don't abort if this fails,
            // since logs for deleted pairs are filtered out on load anyway).
            await supabase
              .from("mentorship_logs")
              .update({ deleted_at: new Date().toISOString() })
              .eq("organization_id", orgId)
              .eq("pair_id", pair.id)
              .is("deleted_at", null);

            const { error: pairError } = await supabase
              .from("mentorship_pairs")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", pair.id)
              .eq("organization_id", orgId)
              .is("deleted_at", null);

            if (pairError) {
              setError("Unable to archive this pair. Please try again.");
              setIsDeleting(false);
              return;
            }

            setIsDeleting(false);
            onArchive(pair.id);
          },
        },
      ]
    );
  };

  const isMine = isUserInMentorshipPair(pair, userId ?? undefined);
  const status = normalizeMentorshipStatus(pair.status);
  const canLogActivity = canCreateMentorshipLog({
    role: viewerRole,
    status: pair.status,
  });
  const statusColor =
    status === "completed"
      ? styles.statusCompleted.color
      : status === "paused"
        ? styles.statusPaused.color
        : styles.statusActive.color;

  return (
    <View style={[styles.card, isMine && styles.highlightedCard]}>
      <View style={styles.pairHeader}>
        <View style={styles.pairColumn}>
          <Text style={styles.pairName}>{mentorLabel}</Text>
          <Text style={styles.pairRole}>Mentor</Text>
        </View>
        <View style={styles.pairCenter}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {status}
            </Text>
          </View>
          {isAdmin ? (
            <Pressable
              onPress={handleDelete}
              disabled={isDeleting}
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.deleteButtonPressed,
                isDeleting && styles.buttonDisabled,
              ]}
            >
              <Trash2 size={14} color={styles.deleteButtonText.color} />
              <Text style={styles.deleteButtonText}>Archive</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.pairColumnRight}>
          <Text style={styles.pairName}>{menteeLabel}</Text>
          <Text style={styles.pairRole}>Mentee</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {logs.length > 0 ? (
        <View style={styles.logList}>
          {logs.slice(0, 5).map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logMeta}>
                <Text style={styles.logMetaText}>
                  {formatDefaultDateFromString(log.entry_date)}
                </Text>
                <Text style={styles.logMetaText}>Logged by {userLabel(log.created_by)}</Text>
              </View>
              {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
              {log.progress_metric !== null ? (
                <Text style={styles.logMetric}>
                  Progress metric: {log.progress_metric}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptySubtitle}>No activity logged yet.</Text>
      )}

      {canLogActivity && userId ? (
        <View style={styles.logFormContainer}>
          <MentorshipLogForm
            orgId={orgId}
            pairId={pair.id}
            userId={userId}
            onSaved={onRefresh}
          />
        </View>
      ) : null}

      {onOpenPair ? (
        <View style={styles.footerRow}>
          <Pressable
            onPress={() => onOpenPair(pair.id)}
            style={({ pressed }) => [
              styles.openButton,
              pressed && styles.openButtonPressed,
            ]}
          >
            <Text style={styles.openButtonText}>Open pair</Text>
            <ChevronRight size={16} color={styles.openButtonText.color} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    highlightedCard: {
      borderColor: s.success,
      borderWidth: 2,
    },
    pairHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: SPACING.md,
    },
    pairColumn: {
      flex: 1,
    },
    pairColumnRight: {
      flex: 1,
      alignItems: "flex-end",
    },
    pairCenter: {
      alignItems: "center",
      gap: SPACING.xs,
    },
    pairName: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    pairRole: {
      fontSize: 12,
      color: n.muted,
    },
    statusBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontSize: 12,
      fontWeight: "600",
      textTransform: "capitalize",
    },
    statusCompleted: {
      color: n.muted,
    },
    statusPaused: {
      color: s.warning,
    },
    statusActive: {
      color: s.success,
    },
    deleteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: `${s.error}14`,
    },
    deleteButtonPressed: {
      opacity: 0.85,
    },
    deleteButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: s.error,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    logList: {
      gap: SPACING.sm,
    },
    logItem: {
      backgroundColor: n.divider,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
      gap: SPACING.xs,
    },
    logMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    logMetaText: {
      fontSize: 12,
      color: n.muted,
    },
    logNotes: {
      fontSize: 14,
      color: n.foreground,
    },
    logMetric: {
      fontSize: 12,
      color: n.muted,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    logFormContainer: {
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    footerRow: {
      paddingTop: SPACING.xs,
      alignItems: "flex-end",
    },
    openButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: n.divider,
    },
    openButtonPressed: {
      opacity: 0.85,
    },
    openButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: n.foreground,
    },
  });
