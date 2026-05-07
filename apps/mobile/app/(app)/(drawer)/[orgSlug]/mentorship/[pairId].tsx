import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { canCreateMentorshipLog } from "@/lib/mentorship";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { MentorshipLogForm } from "@/components/mentorship/MentorshipLogForm";
import { PairTasksSection } from "@/components/mentorship/PairTasksSection";
import { PairMeetingsSection } from "@/components/mentorship/PairMeetingsSection";
import { formatDefaultDateFromString } from "@/lib/date-format";
import type { MentorshipLog, MentorshipPair, User } from "@teammeet/types";

type SubTab = "logs" | "tasks" | "meetings";

export default function MentorshipPairDetail() {
  const { pairId } = useLocalSearchParams<{ pairId: string }>();
  const router = useRouter();
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { role, isAdmin } = useOrgRole();
  const styles = useThemedStyles(createStyles);

  const [pair, setPair] = useState<MentorshipPair | null>(null);
  const [logs, setLogs] = useState<MentorshipLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SubTab>("logs");

  const userMap = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => {
      map[u.id] = u.name || u.email || "Unknown";
    });
    return map;
  }, [users]);

  const load = useCallback(async () => {
    if (!orgId || !pairId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: pairRow, error: pairError } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("id", pairId)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (pairError) throw pairError;
      if (!pairRow) {
        setError("Pair not found.");
        setPair(null);
        return;
      }

      setPair(pairRow as MentorshipPair);

      const { data: logsRows } = await supabase
        .from("mentorship_logs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("pair_id", pairId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });

      setLogs((logsRows || []) as MentorshipLog[]);

      const ids = [pairRow.mentor_user_id, pairRow.mentee_user_id];
      const { data: usersData } = await supabase
        .from("users")
        .select("id, name, email")
        .in("id", ids);
      setUsers((usersData || []) as User[]);
    } catch (err) {
      setError((err as Error).message || "Failed to load pair details.");
    } finally {
      setLoading(false);
    }
  }, [orgId, pairId]);

  useEffect(() => {
    load();
  }, [load]);

  const isMentor = pair && user?.id === pair.mentor_user_id;
  const canLogActivity = pair
    ? canCreateMentorshipLog({ role, status: pair.status })
    : false;
  const canEditTasks = Boolean(isMentor || isAdmin);
  const canEditMeetings = Boolean(isMentor || isAdmin);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.backButton}
            >
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Mentorship</Text>
              {pair ? (
                <Text style={styles.headerMeta}>
                  {userMap[pair.mentor_user_id]} & {userMap[pair.mentee_user_id]}
                </Text>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={styles.loadingColor.color} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={load}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : pair ? (
          <>
            <View style={styles.subTabs}>
              {(["logs", "tasks", "meetings"] as const).map((tab) => {
                const active = activeTab === tab;
                return (
                  <Pressable
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    style={({ pressed }) => [
                      styles.subTab,
                      active && styles.subTabActive,
                      pressed && styles.subTabPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.subTabLabel,
                        active && styles.subTabLabelActive,
                      ]}
                    >
                      {tab === "logs"
                        ? "Activity"
                        : tab === "tasks"
                          ? "Tasks"
                          : "Meetings"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {activeTab === "logs" ? (
                <>
                  {logs.length === 0 ? (
                    <View style={styles.card}>
                      <Text style={styles.emptyTitle}>No activity logged yet</Text>
                      <Text style={styles.emptySubtitle}>
                        Capture each conversation so you can look back later.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.list}>
                      {logs.map((log) => (
                        <View key={log.id} style={styles.card}>
                          <View style={styles.logMeta}>
                            <Text style={styles.logMetaText}>
                              {formatDefaultDateFromString(log.entry_date)}
                            </Text>
                            <Text style={styles.logMetaText}>
                              by {userMap[log.created_by] || "—"}
                            </Text>
                          </View>
                          {log.notes ? (
                            <Text style={styles.logNotes}>{log.notes}</Text>
                          ) : null}
                          {log.progress_metric != null ? (
                            <Text style={styles.logMetric}>
                              Progress metric: {log.progress_metric}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                  {canLogActivity && orgId && user?.id ? (
                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>Log activity</Text>
                      <MentorshipLogForm
                        orgId={orgId}
                        pairId={pair.id}
                        userId={user.id}
                        onSaved={load}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              {activeTab === "tasks" && orgId ? (
                <PairTasksSection
                  orgId={orgId}
                  pairId={pair.id}
                  canEdit={canEditTasks}
                />
              ) : null}

              {activeTab === "meetings" && orgId ? (
                <PairMeetingsSection
                  orgId={orgId}
                  pairId={pair.id}
                  canEdit={canEditMeetings}
                />
              ) : null}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.05)",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: 12,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    subTabs: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: n.border,
      backgroundColor: n.surface,
    },
    subTab: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    subTabActive: {
      borderBottomWidth: 2,
      borderBottomColor: s.success,
    },
    subTabPressed: {
      opacity: 0.85,
    },
    subTabLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: n.muted,
    },
    subTabLabelActive: {
      color: n.foreground,
    },
    scrollContent: {
      padding: SPACING.md,
      gap: SPACING.md,
      paddingBottom: SPACING.xl,
    },
    list: {
      gap: SPACING.sm,
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
    cardTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
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
    logMeta: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    logMetaText: {
      fontSize: 12,
      color: n.muted,
    },
    logNotes: {
      fontSize: 14,
      color: n.foreground,
      lineHeight: 20,
    },
    logMetric: {
      fontSize: 12,
      color: n.muted,
    },
    loadingState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingColor: {
      color: s.success,
    },
    errorCard: {
      margin: SPACING.md,
      padding: SPACING.md,
      backgroundColor: `${s.error}14`,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      borderRadius: RADIUS.md,
      gap: SPACING.sm,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      borderRadius: RADIUS.md,
      backgroundColor: s.error,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
  });
