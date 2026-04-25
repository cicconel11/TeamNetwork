import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { MentorshipPairCard } from "./MentorshipPairCard";
import type { MentorshipPairRecord } from "@/lib/mentorship";
import type { MentorshipLog } from "@teammeet/types";

export function MentorshipPairsList({
  pairs,
  logsByPair,
  userLabel,
  isAdmin,
  viewerRole,
  orgId,
  userId,
  onRefresh,
  onArchive,
  onOpenPair,
}: {
  pairs: MentorshipPairRecord[];
  logsByPair: Record<string, MentorshipLog[]>;
  userLabel: (id: string) => string;
  isAdmin: boolean;
  viewerRole: string | null;
  orgId: string;
  userId: string | null;
  onRefresh: () => void;
  onArchive: (pairId: string) => void;
  onOpenPair?: (pairId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);

  if (pairs.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No mentorship pairs yet</Text>
        <Text style={styles.emptySubtitle}>Pairs will appear here once created.</Text>
      </View>
    );
  }

  return (
    <View style={styles.pairsList}>
      {pairs.map((pair) => (
        <MentorshipPairCard
          key={pair.id}
          pair={pair}
          mentorLabel={userLabel(pair.mentor_user_id)}
          menteeLabel={userLabel(pair.mentee_user_id)}
          logs={logsByPair[pair.id] || []}
          isAdmin={isAdmin}
          viewerRole={viewerRole}
          orgId={orgId}
          userId={userId}
          userLabel={userLabel}
          onRefresh={onRefresh}
          onArchive={onArchive}
          onOpenPair={onOpenPair}
        />
      ))}
    </View>
  );
}

const createStyles = (n: NeutralColors, _s: SemanticColors) =>
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
    pairsList: {
      gap: SPACING.md,
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
