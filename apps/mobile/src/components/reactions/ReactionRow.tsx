import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { SmilePlus } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useReactions, type ReactionTargetKind } from "@/hooks/useReactions";

const QUICK_REACTIONS = ["👍", "❤️", "🎉", "🔥", "👀", "😂"] as const;

interface Props {
  targetKind: ReactionTargetKind;
  targetId: string | null;
  currentUserId: string | null;
}

/**
 * Inline reaction strip for any commentable surface. Existing reactions
 * render as pills; the trailing + opens a quick-picker popover.
 */
export function ReactionRow({ targetKind, targetId, currentUserId }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { reactions, toggle } = useReactions(targetKind, targetId, currentUserId);

  const styles = useThemedStyles((n) => ({
    row: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 6,
      paddingTop: SPACING.xs,
    },
    pill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    pillActive: {
      backgroundColor: n.background,
      borderColor: n.foreground,
    },
    emoji: { fontSize: 14 },
    count: {
      ...TYPOGRAPHY.labelSmall,
      color: n.foreground,
    },
    addButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      width: 28,
      height: 28,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    picker: {
      flexDirection: "row" as const,
      gap: 6,
      padding: 6,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    pickerEmoji: { fontSize: 22 },
  }));

  if (!targetId) return null;

  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          style={[styles.pill, r.userReacted && styles.pillActive]}
          onPress={() => void toggle(r.emoji)}
        >
          <Text style={styles.emoji}>{r.emoji}</Text>
          <Text style={styles.count}>{r.count}</Text>
        </Pressable>
      ))}
      {pickerOpen ? (
        <View style={styles.picker}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                void toggle(emoji);
                setPickerOpen(false);
              }}
            >
              <Text style={styles.pickerEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          style={styles.addButton}
          onPress={() => setPickerOpen(true)}
          accessibilityLabel="Add reaction"
        >
          <SmilePlus size={14} />
        </Pressable>
      )}
    </View>
  );
}
