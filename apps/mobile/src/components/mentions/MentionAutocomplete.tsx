import React, { useMemo } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { Avatar } from "@/components/ui/Avatar";

export interface MentionCandidate {
  id: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
}

interface Props {
  // Active query — the text after the most recent unmatched "@". `null` hides
  // the picker. Empty string ("") shows all members.
  query: string | null;
  candidates: MentionCandidate[];
  excludeId?: string | null;
  onPick: (candidate: MentionCandidate) => void;
}

/**
 * Floating member list that appears above the chat composer when the user
 * types `@`. Selection inserts a mention marker into the message body via
 * `buildMentionMarker` upstream — this component only handles the UI.
 */
export function MentionAutocomplete({ query, candidates, excludeId, onPick }: Props) {
  const styles = useThemedStyles((n) => ({
    wrapper: {
      maxHeight: 200,
      borderTopLeftRadius: RADIUS.md,
      borderTopRightRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
      overflow: "hidden" as const,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    rowPressed: { backgroundColor: n.background },
    name: { ...TYPOGRAPHY.bodyMedium, color: n.foreground },
    empty: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      padding: SPACING.md,
      textAlign: "center" as const,
    },
  }));

  const filtered = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase().trim();
    return candidates
      .filter((c) => !excludeId || c.id !== excludeId)
      .filter((c) => {
        if (!needle) return true;
        return (
          c.name.toLowerCase().includes(needle) ||
          (c.email ?? "").toLowerCase().includes(needle)
        );
      })
      .slice(0, 8);
  }, [query, candidates, excludeId]);

  if (query === null) return null;

  return (
    <View style={styles.wrapper}>
      {filtered.length === 0 ? (
        <Text style={styles.empty}>No matching members</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${item.name}`}
            >
              <Avatar size="xs" uri={item.avatar_url ?? undefined} name={item.name} />
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
