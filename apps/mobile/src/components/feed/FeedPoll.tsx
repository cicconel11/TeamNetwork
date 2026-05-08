import React, { useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { Check } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { showToast } from "@/components/ui/Toast";
import type { PollMetadata } from "@/types/feed";

interface FeedPollProps {
  postId: string;
  meta: PollMetadata;
  userVote: number | null;
  voteCounts: number[];
  totalVotes: number;
  onVote: (postId: string, optionIndex: number) => void;
  disabled?: boolean;
}

function FeedPollInner({
  postId,
  meta,
  userVote,
  voteCounts,
  totalVotes,
  onVote,
  disabled = false,
}: FeedPollProps) {
  const { semantic } = useAppColorScheme();
  const hasVoted = userVote !== null;
  const showResults = hasVoted;

  const handlePress = useCallback(
    (i: number) => {
      if (disabled) {
        showToast("Can't vote — offline or busy", "info");
        return;
      }
      if (hasVoted && !meta.allow_change) {
        showToast("This poll doesn't allow changing votes", "info");
        return;
      }
      if (userVote === i) {
        return;
      }
      onVote(postId, i);
    },
    [disabled, hasVoted, meta.allow_change, userVote, onVote, postId],
  );

  const styles = useThemedStyles((n, s) => ({
    container: {
      gap: SPACING.xs,
      marginBottom: SPACING.sm,
    },
    question: {
      ...TYPOGRAPHY.bodyMedium,
      fontWeight: "600" as const,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    options: {
      gap: SPACING.xs,
    },
    voteButton: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      backgroundColor: n.background,
    },
    voteButtonPressed: {
      backgroundColor: n.divider,
      borderColor: s.info,
    },
    voteLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "500" as const,
    },
    resultRow: {
      position: "relative" as const,
      height: 44,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      overflow: "hidden" as const,
      justifyContent: "center" as const,
    },
    resultRowSelected: {
      borderColor: s.info,
      borderLeftWidth: 3,
    },
    resultFill: {
      position: "absolute" as const,
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: n.divider,
    },
    resultFillSelected: {
      backgroundColor: s.info + "26", // ~15% alpha
    },
    resultContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: SPACING.md,
      gap: SPACING.sm,
    },
    resultLabelWrap: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
      flexShrink: 1,
    },
    resultLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "500" as const,
      flexShrink: 1,
    },
    resultLabelSelected: {
      fontWeight: "700" as const,
    },
    resultPct: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
      fontVariant: ["tabular-nums" as const],
    },
    footer: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: SPACING.xxs,
    },
  }));

  return (
    <View style={styles.container}>
      {meta.question ? (
        <Text style={styles.question} numberOfLines={3}>
          {meta.question}
        </Text>
      ) : null}

      <View style={styles.options}>
        {meta.options.map((opt, i) => {
          const count = voteCounts[i] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = userVote === i;

          if (!showResults) {
            return (
              <Pressable
                key={i}
                onPress={() => handlePress(i)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Vote for ${opt.label}`}
                style={({ pressed }) => [
                  styles.voteButton,
                  pressed && styles.voteButtonPressed,
                ]}
              >
                <Text style={styles.voteLabel} numberOfLines={2}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              key={i}
              onPress={() => handlePress(i)}
              accessibilityRole="button"
              accessibilityLabel={`${opt.label}, ${pct}%`}
              style={[styles.resultRow, isSelected && styles.resultRowSelected]}
            >
              <View
                style={[
                  styles.resultFill,
                  isSelected && styles.resultFillSelected,
                  { width: `${pct}%` },
                ]}
              />
              <View style={styles.resultContent}>
                <View style={styles.resultLabelWrap}>
                  {isSelected ? (
                    <Check size={14} color={semantic.info} />
                  ) : null}
                  <Text
                    style={[styles.resultLabel, isSelected && styles.resultLabelSelected]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </View>
                <Text style={styles.resultPct}>{pct}%</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.footer}>
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        {meta.allow_change && hasVoted ? " · Tap to change" : ""}
      </Text>
    </View>
  );
}

export const FeedPoll = React.memo(FeedPollInner);
