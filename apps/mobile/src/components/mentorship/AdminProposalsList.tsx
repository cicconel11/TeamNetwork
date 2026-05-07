import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import {
  getProposalQueue,
  patchPair,
  remindMentor,
  type ProposalQueueRow,
} from "@/lib/mentorship-api";

export function AdminProposalsList({
  orgId,
  onChanged,
}: {
  orgId: string;
  onChanged: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [rows, setRows] = useState<ProposalQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { queue } = await getProposalQueue(orgId, "score");
      setRows(queue);
    } catch (err) {
      setError((err as Error).message || "Failed to load proposals.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (pairId: string) => {
    setBusyId(pairId);
    try {
      await patchPair(orgId, pairId, { action: "accept" });
      setRows((prev) => prev.filter((r) => r.id !== pairId));
      onChanged();
    } catch (err) {
      Alert.alert("Could not accept", (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = (pairId: string) => {
    Alert.alert(
      "Decline proposal?",
      "The mentee will be notified and will be able to request another mentor.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setBusyId(pairId);
            try {
              await patchPair(orgId, pairId, { action: "decline" });
              setRows((prev) => prev.filter((r) => r.id !== pairId));
              onChanged();
            } catch (err) {
              Alert.alert("Could not decline", (err as Error).message);
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const handleRemind = async (mentorUserId: string) => {
    try {
      await remindMentor(orgId, mentorUserId);
      Alert.alert("Reminder sent", "We pinged the mentor about pending requests.");
    } catch (err) {
      Alert.alert("Could not send reminder", (err as Error).message);
    }
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={styles.spinnerColor.color} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          onPress={load}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No pending proposals</Text>
        <Text style={styles.emptySubtitle}>
          New mentorship requests will show up here for review.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {rows.map((row) => {
        const score = typeof row.match_score === "number" ? Math.round(row.match_score) : null;
        const isBusy = busyId === row.id;
        const menteeName =
          row.mentee_user?.name?.trim() || row.mentee_user?.email?.trim() || "Mentee";
        const mentorName =
          row.mentor_user?.name?.trim() || row.mentor_user?.email?.trim() || "Mentor";

        return (
          <View key={row.id} style={styles.card}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.peopleLine}>
                  <Text style={styles.peopleName}>{menteeName}</Text>{" "}
                  <Text style={styles.arrow}>→</Text>{" "}
                  <Text style={styles.peopleName}>{mentorName}</Text>
                </Text>
                {row.proposed_at ? (
                  <Text style={styles.metaText}>
                    Requested {formatRelative(row.proposed_at)}
                  </Text>
                ) : null}
              </View>
              {score !== null ? (
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreText}>{score}</Text>
                  <Text style={styles.scoreLabel}>match</Text>
                </View>
              ) : null}
            </View>

            {row.mentee_preferences?.goals ? (
              <Text style={styles.goalsText} numberOfLines={3}>
                <Text style={styles.goalsLabel}>Goals: </Text>
                {row.mentee_preferences.goals}
              </Text>
            ) : null}

            {row.mentee_preferences?.required_attributes?.length ? (
              <View style={styles.tagRow}>
                {row.mentee_preferences.required_attributes.slice(0, 4).map((a) => (
                  <View key={a} style={styles.tag}>
                    <Text style={styles.tagText}>{labelizeAttribute(a)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                onPress={() => handleAccept(row.id)}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  isBusy && styles.buttonDisabled,
                ]}
              >
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Accept</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => handleDecline(row.id)}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                  isBusy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.dangerButtonText}>Decline</Text>
              </Pressable>
              <Pressable
                onPress={() => handleRemind(row.mentor_user_id)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Remind</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function labelizeAttribute(key: string) {
  return key.replace(/_/g, " ");
}

function formatRelative(iso: string) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    list: {
      gap: SPACING.md,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: SPACING.sm,
    },
    peopleLine: {
      fontSize: 15,
      color: n.foreground,
      lineHeight: 22,
    },
    peopleName: {
      fontWeight: "700",
    },
    arrow: {
      color: n.muted,
    },
    metaText: {
      fontSize: 12,
      color: n.muted,
      marginTop: 2,
    },
    scoreBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.md,
      backgroundColor: `${s.success}1f`,
      alignItems: "center",
    },
    scoreText: {
      fontSize: 18,
      fontWeight: "700",
      color: s.success,
    },
    scoreLabel: {
      fontSize: 10,
      color: s.success,
      textTransform: "uppercase",
    },
    goalsText: {
      fontSize: 13,
      color: n.foreground,
      lineHeight: 18,
    },
    goalsLabel: {
      fontWeight: "600",
      color: n.muted,
    },
    tagRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    tag: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: n.divider,
      borderWidth: 1,
      borderColor: n.border,
    },
    tagText: {
      fontSize: 11,
      fontWeight: "500",
      color: n.foreground,
      textTransform: "capitalize",
    },
    actionRow: {
      flexDirection: "row",
      gap: SPACING.sm,
      paddingTop: SPACING.xs,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    dangerButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      backgroundColor: `${s.error}10`,
    },
    dangerButtonText: {
      color: s.error,
      fontSize: 14,
      fontWeight: "600",
    },
    secondaryButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      color: n.foreground,
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    spinnerColor: {
      color: s.success,
    },
  });
