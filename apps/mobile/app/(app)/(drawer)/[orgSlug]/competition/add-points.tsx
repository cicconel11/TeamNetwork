import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useNavigation } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { CompetitionTeam } from "@teammeet/types";

export default function CompetitionAddPointsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();

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

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/${orgSlug}/competition`);
    }
  }, [navigation, router, orgSlug]);

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
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Add Points</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator color={SEMANTIC.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Add Points</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>You do not have access to add points.</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Add Points</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Award Points</Text>
            <Text style={styles.formSubtitle}>Award points to a team in the competition</Text>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
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
                        selected && styles.optionRowSelected,
                        pressed && styles.optionRowPressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.optionIndicator,
                          selected && styles.optionIndicatorSelected,
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
                if (value) setTeamId("");
              }}
              placeholder="e.g., Blue Squad"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Points</Text>
            <TextInput
              value={points}
              onChangeText={setPoints}
              placeholder="Enter points (can be negative)"
              placeholderTextColor={NEUTRAL.placeholder}
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
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g., Won the scrimmage, community service hours"
              placeholderTextColor={NEUTRAL.placeholder}
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
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Add Points</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {
    // Gradient fills this area
  },
  headerSafeArea: {
    // SafeAreaView handles top inset
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -SPACING.sm,
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.sm,
  },
  loadingText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  formHeader: {
    gap: SPACING.xs,
  },
  formTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
  },
  formSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.secondary,
  },
  errorCard: {
    backgroundColor: SEMANTIC.errorLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: SEMANTIC.error,
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
  },
  fieldGroup: {
    gap: SPACING.xs,
  },
  fieldLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  input: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    backgroundColor: NEUTRAL.surface,
  },
  textArea: {
    minHeight: 120,
  },
  optionList: {
    gap: SPACING.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    backgroundColor: NEUTRAL.surface,
  },
  optionRowSelected: {
    borderColor: SEMANTIC.success,
    backgroundColor: SEMANTIC.successLight,
  },
  optionRowPressed: {
    opacity: 0.85,
  },
  optionIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: NEUTRAL.muted,
    backgroundColor: "transparent",
  },
  optionIndicatorSelected: {
    borderColor: SEMANTIC.success,
    backgroundColor: SEMANTIC.success,
  },
  optionLabel: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    flex: 1,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  primaryButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
