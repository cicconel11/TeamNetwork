import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import {
  labelMatchSignal,
  pickMatchSignalCode,
  type MatchSignal,
  type MentorshipPairRecord,
} from "@/lib/mentorship";
import { patchPair } from "@/lib/mentorship-api";

type ProposalSectionProps = {
  orgId: string;
  currentUserId: string;
  pairs: MentorshipPairRecord[];
  userLabel: (id: string) => string;
  onChanged: () => void;
};

export function MyProposalsSection({
  orgId,
  currentUserId,
  pairs,
  userLabel,
  onChanged,
}: ProposalSectionProps) {
  const styles = useThemedStyles(createStyles);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const incoming = useMemo(
    () => pairs.filter((pair) => pair.mentor_user_id === currentUserId),
    [pairs, currentUserId]
  );
  const outgoing = useMemo(
    () => pairs.filter((pair) => pair.mentee_user_id === currentUserId),
    [pairs, currentUserId]
  );

  const handleAction = async (
    pairId: string,
    action: "accept" | "decline",
    reason?: string
  ) => {
    setBusyId(pairId);
    setError(null);

    try {
      await patchPair(orgId, pairId, { action, reason });
      setReasonFor(null);
      setReasonText("");
      onChanged();
    } catch (err) {
      setError((err as Error).message || "Could not update proposal.");
    } finally {
      setBusyId(null);
    }
  };

  if (pairs.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No proposals yet</Text>
        <Text style={styles.emptySubtitle}>
          Your mentorship requests and review items will show up here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {incoming.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Incoming proposals</Text>
          <View style={styles.list}>
            {incoming.map((pair) => (
              <ProposalCard
                key={pair.id}
                pair={pair}
                otherPartyLabel={userLabel(pair.mentee_user_id)}
                directionLabel="Mentee"
                isIncoming
                isBusy={busyId === pair.id}
                reasonFor={reasonFor}
                reasonText={reasonText}
                onReasonChange={setReasonText}
                onStartDecline={() => setReasonFor(pair.id)}
                onCancelDecline={() => {
                  setReasonFor(null);
                  setReasonText("");
                }}
                onAccept={() => handleAction(pair.id, "accept")}
                onConfirmDecline={() =>
                  handleAction(pair.id, "decline", reasonText.trim() || undefined)
                }
              />
            ))}
          </View>
        </View>
      ) : null}

      {outgoing.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Outgoing proposals</Text>
          <View style={styles.list}>
            {outgoing.map((pair) => (
              <ProposalCard
                key={pair.id}
                pair={pair}
                otherPartyLabel={userLabel(pair.mentor_user_id)}
                directionLabel="Mentor"
                isIncoming={false}
                isBusy={busyId === pair.id}
                reasonFor={reasonFor}
                reasonText={reasonText}
                onReasonChange={setReasonText}
                onStartDecline={() => {}}
                onCancelDecline={() => {}}
                onAccept={() => {}}
                onConfirmDecline={() => {}}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ProposalCard({
  pair,
  otherPartyLabel,
  directionLabel,
  isIncoming,
  isBusy,
  reasonFor,
  reasonText,
  onReasonChange,
  onStartDecline,
  onCancelDecline,
  onAccept,
  onConfirmDecline,
}: {
  pair: MentorshipPairRecord;
  otherPartyLabel: string;
  directionLabel: string;
  isIncoming: boolean;
  isBusy: boolean;
  reasonFor: string | null;
  reasonText: string;
  onReasonChange: (value: string) => void;
  onStartDecline: () => void;
  onCancelDecline: () => void;
  onAccept: () => void;
  onConfirmDecline: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const status = pair.status ?? "unknown";
  const statusStyle =
    status === "proposed"
      ? styles.statusProposed
      : status === "declined" || status === "expired"
        ? styles.statusDeclined
        : styles.statusOther;

  const signals = Array.isArray(pair.match_signals)
    ? (pair.match_signals as MatchSignal[])
    : [];
  const isDeclining = reasonFor === pair.id;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.label}>{directionLabel}</Text>
          <Text style={styles.name}>{otherPartyLabel}</Text>
        </View>
        <View style={[styles.statusBadge, statusStyle]}>
          <Text style={[styles.statusText, statusStyle]}>{status}</Text>
        </View>
      </View>

      {typeof pair.match_score === "number" ? (
        <Text style={styles.metaText}>Match score: {Math.round(pair.match_score)}</Text>
      ) : null}

      {signals.length > 0 ? (
        <View style={styles.tagRow}>
          {signals.slice(0, 4).map((signal, index) => {
            const code = pickMatchSignalCode(signal);
            const label =
              typeof signal.label === "string" && signal.label.length > 0
                ? signal.label
                : labelMatchSignal(code);
            return (
              <View
                key={`${code ?? "signal"}-${index}`}
                style={styles.tag}
              >
                <Text style={styles.tagText}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.helperText}>
        {isIncoming
          ? status === "proposed"
            ? "Review this request to start the mentorship pair."
            : status === "declined"
              ? pair.declined_reason || "This request was declined."
              : status === "expired"
                ? "This proposal expired before it was accepted."
                : `Status: ${status}`
          : status === "proposed"
            ? "Your request is waiting for review."
            : status === "declined"
              ? pair.declined_reason || "This request was declined."
              : status === "expired"
                ? "This proposal expired before it was accepted."
                : `Status: ${status}`}
      </Text>

      {isIncoming && status === "proposed" ? (
        isDeclining ? (
          <View style={styles.actionStack}>
            <TextInput
              value={reasonText}
              onChangeText={onReasonChange}
              placeholder="Optional decline reason"
              placeholderTextColor={styles.placeholderColor.color}
              multiline
              textAlignVertical="top"
              style={styles.textArea}
            />
            <View style={styles.actionRow}>
              <Pressable
                onPress={onCancelDecline}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmDecline}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.dangerButton,
                  pressed && styles.buttonPressed,
                  isBusy && styles.buttonDisabled,
                ]}
              >
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.dangerButtonText}>Confirm decline</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <Pressable
              onPress={onStartDecline}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
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
          </View>
        )
      ) : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    section: {
      gap: SPACING.sm,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: n.muted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
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
    nameBlock: {
      flex: 1,
      gap: 2,
    },
    label: {
      fontSize: 12,
      color: n.muted,
      textTransform: "uppercase",
    },
    name: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    metaText: {
      fontSize: 12,
      color: n.muted,
    },
    statusBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: 999,
    },
    statusText: {
      fontSize: 12,
      fontWeight: "600",
      textTransform: "capitalize",
    },
    statusProposed: {
      color: s.warning,
      backgroundColor: `${s.warning}1f`,
    },
    statusDeclined: {
      color: s.error,
      backgroundColor: `${s.error}14`,
    },
    statusOther: {
      color: n.muted,
      backgroundColor: n.divider,
    },
    helperText: {
      fontSize: 13,
      color: n.muted,
      lineHeight: 18,
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
    },
    actionRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: SPACING.sm,
      flexWrap: "wrap",
    },
    actionStack: {
      gap: SPACING.sm,
    },
    textArea: {
      minHeight: 84,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 15,
      color: n.foreground,
      backgroundColor: n.background,
    },
    placeholderColor: {
      color: n.muted,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 110,
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    secondaryButton: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      color: n.foreground,
      fontSize: 14,
      fontWeight: "600",
    },
    dangerButton: {
      backgroundColor: s.error,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
      minWidth: 136,
    },
    dangerButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
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
  });
