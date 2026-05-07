import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { getMentorMatches } from "@/lib/mentorship-api";
import { MentorRequestSheet } from "./MentorRequestSheet";
import type { MentorDirectoryEntry, MentorMatch } from "@/types/mentorship";

export function MentorMatchesSection({
  orgId,
  currentUserId,
  mentors,
  pendingMentorIds,
  onRequested,
}: {
  orgId: string;
  currentUserId: string;
  mentors: MentorDirectoryEntry[];
  pendingMentorIds: Set<string>;
  onRequested: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [matches, setMatches] = useState<MentorMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestMentor, setRequestMentor] = useState<MentorDirectoryEntry | null>(null);

  const mentorMap = useMemo(
    () => new Map(mentors.map((mentor) => [mentor.user_id, mentor])),
    [mentors]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { matches: nextMatches } = await getMentorMatches(orgId, currentUserId, {
        limit: 10,
      });
      setMatches(nextMatches);
    } catch (err) {
      setError((err as Error).message || "Failed to load matches.");
    } finally {
      setLoading(false);
    }
  }, [orgId, currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={styles.loadingColor.color} />
        <Text style={styles.helperText}>Finding mentors that fit your preferences…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          onPress={load}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (matches.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No suggested mentors yet</Text>
        <Text style={styles.helperText}>
          Update your preferences or browse the full directory to request a mentor.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.list}>
        {matches.map((match) => {
          const mentor = mentorMap.get(match.mentorUserId) ?? null;
          const isPending = pendingMentorIds.has(match.mentorUserId);
          const isUnavailable = mentor ? !mentor.accepting_new : true;
          const isFull = mentor
            ? mentor.current_mentee_count >= mentor.max_mentees
            : false;
          const disabled = isPending || isUnavailable || isFull || !mentor;
          const buttonLabel = isPending
            ? "Pending"
            : isUnavailable
              ? "Unavailable"
              : isFull
                ? "Full"
                : "Request mentorship";

          return (
            <View key={match.mentorUserId} style={styles.card}>
              <View style={styles.headerRow}>
                <View style={styles.nameBlock}>
                  <Text style={styles.name}>{match.mentor.name}</Text>
                  {match.mentor.subtitle ? (
                    <Text style={styles.metaText}>{match.mentor.subtitle}</Text>
                  ) : null}
                  {mentor ? (
                    <Text style={styles.metaText}>
                      {mentor.current_mentee_count} / {mentor.max_mentees} mentees
                    </Text>
                  ) : null}
                </View>
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreText}>{Math.round(match.score)}</Text>
                  <Text style={styles.scoreLabel}>match</Text>
                </View>
              </View>

              {match.reasons.length > 0 ? (
                <View style={styles.tagRow}>
                  {match.reasons.slice(0, 4).map((reason) => (
                    <View key={`${match.mentorUserId}-${reason.code}`} style={styles.tag}>
                      <Text style={styles.tagText}>{reason.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {mentor?.topics?.length ? (
                <Text style={styles.helperText}>
                  Topics: {mentor.topics.slice(0, 3).join(", ")}
                </Text>
              ) : null}

              {mentor?.bio ? (
                <Text style={styles.bioText} numberOfLines={3}>
                  {mentor.bio}
                </Text>
              ) : null}

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => mentor && setRequestMentor(mentor)}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    disabled && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>{buttonLabel}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <MentorRequestSheet
        visible={requestMentor !== null}
        mentor={requestMentor}
        orgId={orgId}
        onClose={() => setRequestMentor(null)}
        onRequested={() => {
          setRequestMentor(null);
          void load();
          onRequested();
        }}
      />
    </>
  );
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
    nameBlock: {
      flex: 1,
      gap: 2,
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
    bioText: {
      fontSize: 14,
      color: n.foreground,
      lineHeight: 20,
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
      backgroundColor: `${s.success}12`,
      borderWidth: 1,
      borderColor: `${s.success}25`,
    },
    tagText: {
      fontSize: 11,
      fontWeight: "600",
      color: s.success,
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
    actionRow: {
      alignItems: "flex-start",
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    secondaryButton: {
      alignSelf: "flex-start",
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
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
      opacity: 0.55,
    },
    loadingColor: {
      color: s.success,
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
  });
