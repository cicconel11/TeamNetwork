import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { supabase } from "@/lib/supabase";
import { borderRadius, fontSize, fontWeight, spacing, type ThemeColors } from "@/lib/theme";
import type { CompetitionTeam } from "@teammeet/types";

export default function CompetitionAddPointsScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [teams, setTeams] = useState<CompetitionTeam[]>([]);
  const [teamId, setTeamId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadCompetition = async () => {
      if (!orgId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data: competitions, error: competitionError } = await supabase
        .from("competitions")
        .select("id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!isMounted) return;

      if (competitionError) {
        setError(competitionError.message);
        setLoading(false);
        return;
      }

      const latestCompetition = competitions?.[0];
      setCompetitionId(latestCompetition?.id ?? null);

      if (latestCompetition?.id) {
        const { data: teamRows, error: teamError } = await supabase
          .from("competition_teams")
          .select("*")
          .eq("competition_id", latestCompetition.id)
          .order("name");

        if (teamError) {
          setError(teamError.message);
          setLoading(false);
          return;
        }

        setTeams((teamRows || []) as CompetitionTeam[]);
      }

      setLoading(false);
    };

    loadCompetition();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const handleSubmit = async () => {
    if (!competitionId || !orgId) {
      setError("Competition not found.");
      return;
    }
    if (!teamId && !teamName.trim()) {
      setError("Select a team or enter a team name.");
      return;
    }
    const parsedPoints = Number.parseInt(points, 10);
    if (Number.isNaN(parsedPoints)) {
      setError("Enter a valid points value.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("competition_points").insert({
      competition_id: competitionId,
      organization_id: orgId,
      team_id: teamId || null,
      team_name: teamName.trim() || null,
      points: parsedPoints,
      notes: notes.trim() || null,
      reason: reason.trim() || null,
      created_by: user?.id || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.push(`/(app)/${orgSlug}/competition`);
  };

  const handleSelectTeam = (id: string) => {
    setTeamId(id);
    setTeamName("");
  };

  if (roleLoading || loading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Add Points" }} />
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </ScrollView>
    );
  }

  if (!isAdmin) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Add Points" }} />
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            You do not have access to add points.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "Add Points" }} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Add Points</Text>
        <Text style={styles.headerSubtitle}>Award points to a team</Text>
      </View>

      {error ? (
        <View style={styles.errorCard}>
          <Text selectable style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Select team</Text>
        {teams.length === 0 ? (
          <Text style={styles.emptyText}>No teams available.</Text>
        ) : (
          <View style={styles.optionList}>
            {teams.map((team) => {
              const selected = teamId === team.id;
              return (
                <Pressable
                  key={team.id}
                  onPress={() => handleSelectTeam(team.id)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    selected && {
                      borderColor: colors.primary,
                      backgroundColor: colors.primaryLight,
                    },
                    pressed && styles.optionRowPressed,
                  ]}
                >
                  <View
                    style={[
                      styles.optionIndicator,
                      selected && { borderColor: colors.primary, backgroundColor: colors.primary },
                    ]}
                  />
                  <Text style={styles.optionLabel}>{team.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Or enter a new team name</Text>
        <TextInput
          value={teamName}
          onChangeText={(value) => {
            setTeamName(value);
            if (value) {
              setTeamId("");
            }
          }}
          placeholder="e.g., Blue Squad"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Points</Text>
        <TextInput
          value={points}
          onChangeText={setPoints}
          placeholder="Enter points (can be negative)"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Reason</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Why the points were awarded"
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g., Won the scrimmage, community service hours"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Add points</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      gap: spacing.xs,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerSubtitle: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    errorCard: {
      backgroundColor: `${colors.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: `${colors.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
    },
    loadingState: {
      alignItems: "center",
      gap: spacing.sm,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    textArea: {
      minHeight: 120,
    },
    optionList: {
      gap: spacing.sm,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    optionRowPressed: {
      opacity: 0.85,
    },
    optionIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      backgroundColor: "transparent",
    },
    optionLabel: {
      fontSize: fontSize.base,
      color: colors.foreground,
      flex: 1,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderCurve: "continuous",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
