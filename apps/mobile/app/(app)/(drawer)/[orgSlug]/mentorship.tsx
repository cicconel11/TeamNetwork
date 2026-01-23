import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  FlatList,
  Switch,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "expo-router";
import { ChevronDown, Trash2 } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { MentorshipLog, MentorshipPair, User } from "@teammeet/types";

// Fixed color palette
const MENTORSHIP_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  mutedForeground: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  mutedSurface: "#f1f5f9",
  primary: "#059669",
  primaryForeground: "#ffffff",
  primaryLight: "#10b981",
  error: "#ef4444",
  success: "#22c55e",
  warning: "#f59e0b",
};

type SelectOption = { value: string; label: string };
type MentorshipStatus = "active" | "paused" | "completed";

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

export default function MentorshipScreen() {
  const { orgId, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { role, isAdmin, isActiveMember, isAlumni, isLoading: roleLoading } = useOrgRole();
  const navigation = useNavigation();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);
  const [pairs, setPairs] = useState<MentorshipPair[]>([]);
  const [logs, setLogs] = useState<MentorshipLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMentorshipData = useCallback(
    async (isRefresh = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setPairs([]);
          setLogs([]);
          setUsers([]);
          setLoading(false);
          setRefreshing(false);
          setError(null);
        }
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const { data: pairsData, error: pairsError } = await supabase
          .from("mentorship_pairs")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false });

        if (pairsError) throw pairsError;

        const pairIds = (pairsData || []).map((pair) => pair.id);
        const { data: logsData, error: logsError } = pairIds.length
          ? await supabase
              .from("mentorship_logs")
              .select("*")
              .eq("organization_id", orgId)
              .in("pair_id", pairIds)
              .order("entry_date", { ascending: false })
              .order("created_at", { ascending: false })
          : { data: [] as MentorshipLog[] };

        if (logsError) throw logsError;

        const userIds = new Set<string>();
        (pairsData || []).forEach((pair) => {
          if (pair.mentor_user_id) userIds.add(pair.mentor_user_id);
          if (pair.mentee_user_id) userIds.add(pair.mentee_user_id);
        });

        const { data: usersData, error: usersError } = userIds.size
          ? await supabase
              .from("users")
              .select("id, name, email")
              .in("id", Array.from(userIds))
          : { data: [] as User[] };

        if (usersError) throw usersError;

        if (isMountedRef.current) {
          setPairs((pairsData || []) as MentorshipPair[]);
          setLogs((logsData || []) as MentorshipLog[]);
          setUsers((usersData || []) as User[]);
          setError(null);
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError((fetchError as Error).message || "Failed to load mentorship data.");
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    loadMentorshipData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadMentorshipData]);

  const handleRefresh = useCallback(() => loadMentorshipData(true), [loadMentorshipData]);

  const filteredPairs = useMemo(() => {
    if (isAdmin) return pairs;
    if (!user?.id) return [];
    if (role === "active_member") {
      return pairs.filter((pair) => pair.mentee_user_id === user.id);
    }
    if (role === "alumni") {
      return pairs.filter((pair) => pair.mentor_user_id === user.id);
    }
    return [];
  }, [pairs, isAdmin, role, user?.id]);

  const userMap = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => {
      map[u.id] = u.name || u.email || "Unknown";
    });
    return map;
  }, [users]);

  const userLabel = useCallback((id: string) => userMap[id] || "Unknown", [userMap]);

  const logsByPair = useMemo(() => {
    return logs.reduce((acc, log) => {
      if (!acc[log.pair_id]) {
        acc[log.pair_id] = [];
      }
      acc[log.pair_id].push(log);
      return acc;
    }, {} as Record<string, MentorshipLog[]>);
  }, [logs]);

  const showLoading = (loading || roleLoading) && pairs.length === 0;

  if (showLoading) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Mentorship</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Content Sheet */}
        <View style={styles.contentSheet}>
          <View style={styles.stateContainer}>
            <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
            <Text style={styles.stateText}>Loading mentorship...</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Mentorship</Text>
              <Text style={styles.headerMeta}>
                {filteredPairs.length} {filteredPairs.length === 1 ? "pair" : "pairs"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={MENTORSHIP_COLORS.primary}
            />
          }
          keyboardShouldPersistTaps="handled"
        >

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={handleRefresh}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.retryButtonPressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {isActiveMember && orgId ? (
            <MenteeStatusToggle orgId={orgId} styles={styles} />
          ) : null}

          {isAdmin && orgId ? (
            <MentorshipAdminPanel
              orgId={orgId}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}

          {!isAdmin && isAlumni && orgId ? (
            <MentorPairManager
              orgId={orgId}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}

          {orgId ? (
            <MentorshipPairsList
              pairs={filteredPairs}
              logsByPair={logsByPair}
              userLabel={userLabel}
              isAdmin={isAdmin}
              canLogActivity={isAdmin || isActiveMember}
              orgId={orgId}
              userId={user?.id ?? null}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function MenteeStatusToggle({
  orgId,
  styles,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"active" | "revoked" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!orgId || !user) {
        if (isMounted) {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      const { data: membership, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      if (!membership || membership.role !== "active_member") {
        setError("Only active members can change mentee availability.");
        setLoading(false);
        return;
      }

      setStatus((membership.status as "active" | "revoked") ?? "active");
      setLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  const handleToggle = async () => {
    if (!status || !user) {
      setError("Unable to update availability right now.");
      return;
    }
    const nextStatus = status === "active" ? "revoked" : "active";
    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: nextStatus })
      .eq("organization_id", orgId)
      .eq("user_id", user.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setStatus(nextStatus);
    setSaving(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Mentee availability</Text>
        <Text style={styles.sectionSubtitle}>
          Toggle whether you are available as an active member mentee.
        </Text>
      </View>
      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Checking availability...</Text>
        </View>
      ) : (
        <>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {status === "active" ? "Currently available" : "Currently not available"}
            </Text>
            <Switch
              value={status === "active"}
              onValueChange={handleToggle}
              disabled={saving}
              trackColor={{ false: MENTORSHIP_COLORS.border, true: MENTORSHIP_COLORS.primaryLight }}
              thumbColor={status === "active" ? MENTORSHIP_COLORS.primary : MENTORSHIP_COLORS.card}
            />
          </View>
        </>
      )}
    </View>
  );
}

function MentorshipAdminPanel({
  orgId,
  styles,
  onRefresh,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const [mentors, setMentors] = useState<SelectOption[]>([]);
  const [mentees, setMentees] = useState<SelectOption[]>([]);
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [menteeId, setMenteeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSelect, setActiveSelect] = useState<"mentor" | "mentee" | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      const { data: mentorRows, error: mentorError } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "alumni");

      if (!isMounted) return;
      if (mentorError) {
        setError(mentorError.message);
        setIsLoading(false);
        return;
      }

      const { data: menteeRows, error: menteeError } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "active_member");

      if (!isMounted) return;
      if (menteeError) {
        setError(menteeError.message);
        setIsLoading(false);
        return;
      }

      setMentors(
        mentorRows?.map((row) => {
          const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            value: row.user_id,
            label: userInfo?.name || userInfo?.email || "Alumni",
          };
        }) || []
      );

      setMentees(
        menteeRows?.map((row) => {
          const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            value: row.user_id,
            label: userInfo?.name || userInfo?.email || "Member",
          };
        }) || []
      );

      setIsLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const handleCreate = async () => {
    if (!mentorId || !menteeId) {
      setError("Select both a mentor and mentee.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("mentorship_pairs").insert({
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: menteeId,
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    const mentorLabel = mentors.find((m) => m.value === mentorId)?.label || "Mentor";
    const menteeLabel = mentees.find((m) => m.value === menteeId)?.label || "Mentee";

    try {
      const response = await fetchWithAuth("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          title: "New Mentorship Pairing",
          body: `You've been paired for mentorship.\n\nMentor: ${mentorLabel}\nMentee: ${menteeLabel}`,
          channel: "both",
          audience: "both",
          targetUserIds: [mentorId, menteeId],
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.warn("Failed to send mentorship pairing notification:", payload?.error || response.status);
      }
    } catch (notifError) {
      console.warn("Failed to send mentorship pairing notification:", notifError);
    }

    setIsSaving(false);
    setMentorId(null);
    setMenteeId(null);
    onRefresh();
  };

  if (isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Loading mentorship controls...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Create pair</Text>
        <Text style={styles.sectionSubtitle}>Pair an alumni mentor with an active member.</Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SelectField
        label="Mentor (alumni)"
        value={mentors.find((m) => m.value === mentorId)?.label || ""}
        placeholder="Select mentor"
        onPress={() => setActiveSelect("mentor")}
        styles={styles}
      />
      <SelectField
        label="Mentee (active member)"
        value={mentees.find((m) => m.value === menteeId)?.label || ""}
        placeholder="Select mentee"
        onPress={() => setActiveSelect("mentee")}
        styles={styles}
      />
      <Pressable
        onPress={handleCreate}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Create pair</Text>
        )}
      </Pressable>

      <SelectModal
        visible={activeSelect === "mentor"}
        title="Select mentor"
        options={mentors}
        selectedValue={mentorId}
        onSelect={(option) => {
          setMentorId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
      <SelectModal
        visible={activeSelect === "mentee"}
        title="Select mentee"
        options={mentees}
        selectedValue={menteeId}
        onSelect={(option) => {
          setMenteeId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
    </View>
  );
}

function MentorPairManager({
  orgId,
  styles,
  onRefresh,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [pairId, setPairId] = useState<string | null>(null);
  const [currentMenteeId, setCurrentMenteeId] = useState<string | null>(null);
  const [initialMenteeId, setInitialMenteeId] = useState<string | null>(null);
  const [availableMentees, setAvailableMentees] = useState<SelectOption[]>([]);
  const [status, setStatus] = useState<MentorshipStatus>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSelect, setActiveSelect] = useState<"mentee" | "status" | null>(null);
  const mentorLabel =
    (user?.user_metadata as { name?: string } | undefined)?.name ||
    user?.email ||
    "Mentor";

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!user) {
        setError("You must be signed in to manage your pair.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setMentorId(user.id);

      const { data: menteeRows, error: menteeError } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("role", "active_member");

      if (!isMounted) return;
      if (menteeError) {
        setError(menteeError.message);
        setIsLoading(false);
        return;
      }

      setAvailableMentees(
        menteeRows?.map((row) => {
          const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            value: row.user_id,
            label: userInfo?.name || userInfo?.email || "Member",
          };
        }) || []
      );

      const { data: pair } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("mentor_user_id", user.id)
        .maybeSingle();

      if (pair) {
        setPairId(pair.id);
        setCurrentMenteeId(pair.mentee_user_id);
        setInitialMenteeId(pair.mentee_user_id);
        const normalizedStatus =
          pair.status === "completed" || pair.status === "paused" ? pair.status : "active";
        setStatus(normalizedStatus as MentorshipStatus);
      }

      setIsLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  const handleAssign = async () => {
    if (!mentorId || !currentMenteeId) {
      setError("Select a mentee to assign.");
      return;
    }

    const shouldNotify = !pairId || currentMenteeId !== initialMenteeId;

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: currentMenteeId,
      status,
    };

    const { data, error: upsertError } = pairId
      ? await supabase
          .from("mentorship_pairs")
          .update(payload)
          .eq("id", pairId)
          .eq("mentor_user_id", mentorId)
          .select("id")
          .maybeSingle()
      : await supabase.from("mentorship_pairs").insert(payload).select("id").maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    if (shouldNotify && mentorId && currentMenteeId) {
      const menteeLabel =
        availableMentees.find((m) => m.value === currentMenteeId)?.label || "Mentee";
      try {
        const response = await fetchWithAuth("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            title: "New Mentorship Pairing",
            body: `You've been paired for mentorship.\n\nMentor: ${mentorLabel}\nMentee: ${menteeLabel}`,
            channel: "both",
            audience: "both",
            targetUserIds: [mentorId, currentMenteeId],
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          console.warn("Failed to send mentorship pairing notification:", payload?.error || response.status);
        }
      } catch (notifError) {
        console.warn("Failed to send mentorship pairing notification:", notifError);
      }
    }

    setPairId(data?.id ?? pairId);
    setIsSaving(false);
    onRefresh();
  };

  const handleRemove = () => {
    if (!pairId || !mentorId) return;

    Alert.alert(
      "Remove mentee?",
      "This will remove your mentorship pairing. You can reassign later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsSaving(true);
            setError(null);

            const { error: deleteError } = await supabase
              .from("mentorship_pairs")
              .delete()
              .eq("id", pairId)
              .eq("mentor_user_id", mentorId);

            if (deleteError) {
              setError(deleteError.message);
              setIsSaving(false);
              return;
            }

            setPairId(null);
            setCurrentMenteeId(null);
            setInitialMenteeId(null);
            setIsSaving(false);
            onRefresh();
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Loading your mentorship controls...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Manage your mentee</Text>
        <Text style={styles.sectionSubtitle}>
          Assign or remove your mentee. Changes apply only to your own pairing.
        </Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SelectField
        label="Mentee (active member)"
        value={availableMentees.find((m) => m.value === currentMenteeId)?.label || ""}
        placeholder="Select mentee"
        onPress={() => setActiveSelect("mentee")}
        styles={styles}
              />
      <SelectField
        label="Status"
        value={STATUS_OPTIONS.find((opt) => opt.value === status)?.label || ""}
        placeholder="Select status"
        onPress={() => setActiveSelect("status")}
        styles={styles}
              />
      <View style={styles.buttonRow}>
        {pairId ? (
          <Pressable
            onPress={handleRemove}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.ghostButton,
              pressed && styles.ghostButtonPressed,
              isSaving && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.ghostButtonText}>Remove mentee</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleAssign}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSaving && styles.buttonDisabled,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
          ) : (
            <Text style={styles.primaryButtonText}>{pairId ? "Update mentee" : "Assign mentee"}</Text>
          )}
        </Pressable>
      </View>

      <SelectModal
        visible={activeSelect === "mentee"}
        title="Select mentee"
        options={availableMentees}
        selectedValue={currentMenteeId}
        onSelect={(option) => {
          setCurrentMenteeId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
              />
      <SelectModal
        visible={activeSelect === "status"}
        title="Select status"
        options={STATUS_OPTIONS}
        selectedValue={status}
        onSelect={(option) => {
          setStatus(option.value as MentorshipStatus);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
              />
    </View>
  );
}

function MentorshipPairsList({
  pairs,
  logsByPair,
  userLabel,
  isAdmin,
  canLogActivity,
  orgId,
  userId,
  styles,
  onRefresh,
}: {
  pairs: MentorshipPair[];
  logsByPair: Record<string, MentorshipLog[]>;
  userLabel: (id: string) => string;
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  userId: string | null;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
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
          canLogActivity={canLogActivity}
          orgId={orgId}
          userId={userId}
          userLabel={userLabel}
          styles={styles}
                    onRefresh={onRefresh}
        />
      ))}
    </View>
  );
}

function MentorshipPairCard({
  pair,
  mentorLabel,
  menteeLabel,
  logs,
  isAdmin,
  canLogActivity,
  orgId,
  userId,
  userLabel,
  styles,
  onRefresh,
}: {
  pair: MentorshipPair;
  mentorLabel: string;
  menteeLabel: string;
  logs: MentorshipLog[];
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  userId: string | null;
  userLabel: (id: string) => string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    Alert.alert(
      "Delete mentorship pair?",
      "This will also remove associated activity logs. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            setError(null);

            const { error: logsError } = await supabase
              .from("mentorship_logs")
              .delete()
              .eq("pair_id", pair.id);

            if (logsError) {
              setError("Unable to delete mentorship logs. Please try again.");
              setIsDeleting(false);
              return;
            }

            const { error: pairError } = await supabase
              .from("mentorship_pairs")
              .delete()
              .eq("id", pair.id);

            if (pairError) {
              setError("Unable to delete mentorship pair. Please try again.");
              setIsDeleting(false);
              return;
            }

            setIsDeleting(false);
            onRefresh();
          },
        },
      ]
    );
  };

  const statusColor =
    pair.status === "completed"
      ? MENTORSHIP_COLORS.secondaryText
      : pair.status === "paused"
        ? MENTORSHIP_COLORS.warning
        : MENTORSHIP_COLORS.success;

  return (
    <View style={styles.card}>
      <View style={styles.pairHeader}>
        <View style={styles.pairColumn}>
          <Text style={styles.pairName}>{mentorLabel}</Text>
          <Text style={styles.pairRole}>Mentor</Text>
        </View>
        <View style={styles.pairCenter}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {pair.status}
            </Text>
          </View>
          {isAdmin ? (
            <Pressable
              onPress={handleDelete}
              disabled={isDeleting}
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.deleteButtonPressed,
                isDeleting && styles.buttonDisabled,
              ]}
            >
              <Trash2 size={14} color={MENTORSHIP_COLORS.error} />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.pairColumnRight}>
          <Text style={styles.pairName}>{menteeLabel}</Text>
          <Text style={styles.pairRole}>Mentee</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {logs.length > 0 ? (
        <View style={styles.logList}>
          {logs.slice(0, 5).map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logMeta}>
                <Text style={styles.logMetaText}>
                  {new Date(log.entry_date).toLocaleDateString()}
                </Text>
                <Text style={styles.logMetaText}>by {userLabel(log.created_by)}</Text>
              </View>
              {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
              {log.progress_metric !== null ? (
                <Text style={styles.logMetric}>Progress: {log.progress_metric}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptySubtitle}>No activity logged yet.</Text>
      )}

      {canLogActivity && userId ? (
        <View style={styles.logFormContainer}>
          <MentorshipLogForm
            orgId={orgId}
            pairId={pair.id}
            userId={userId}
            styles={styles}
                        onSaved={onRefresh}
          />
        </View>
      ) : null}
    </View>
  );
}

function MentorshipLogForm({
  orgId,
  pairId,
  userId,
  styles,
  onSaved,
}: {
  orgId: string;
  pairId: string;
  userId: string;
  styles: ReturnType<typeof createStyles>;
  onSaved: () => void;
}) {
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [progressMetric, setProgressMetric] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!userId) {
      setError("You must be signed in to log progress.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const metricValue = progressMetric.trim()
      ? Number.parseInt(progressMetric, 10)
      : null;
    const sanitizedMetric = Number.isNaN(metricValue) ? null : metricValue;

    const { error: insertError } = await supabase.from("mentorship_logs").insert({
      organization_id: orgId,
      pair_id: pairId,
      created_by: userId,
      entry_date: entryDate.toISOString().slice(0, 10),
      notes: notes.trim() || null,
      progress_metric: sanitizedMetric,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setNotes("");
    setProgressMetric("");
    setIsSaving(false);
    onSaved();
  };

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (selectedDate) {
      setEntryDate(selectedDate);
    }
    if (Platform.OS !== "ios") {
      setShowPicker(false);
    }
  };

  return (
    <View style={styles.logForm}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={({ pressed }) => [
            styles.selectField,
            pressed && styles.selectFieldPressed,
          ]}
        >
          <Text style={styles.selectFieldText}>
            {entryDate.toLocaleDateString()}
          </Text>
          <ChevronDown size={16} color={MENTORSHIP_COLORS.mutedForeground} />
        </Pressable>
        {showPicker ? (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={entryDate}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handleDateChange}
            />
            {Platform.OS === "ios" ? (
              <Pressable
                onPress={() => setShowPicker(false)}
                style={({ pressed }) => [
                  styles.ghostButton,
                  pressed && styles.ghostButtonPressed,
                ]}
              >
                <Text style={styles.ghostButtonText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="What did you work on?"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Progress metric (optional)</Text>
        <TextInput
          value={progressMetric}
          onChangeText={setProgressMetric}
          placeholder="e.g., 3 sessions"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Save log</Text>
        )}
      </Pressable>
    </View>
  );
}

function SelectField({
  label,
  value,
  placeholder,
  onPress,
  styles,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.selectField,
          pressed && styles.selectFieldPressed,
        ]}
      >
        <Text
          style={[
            styles.selectFieldText,
            !value && { color: MENTORSHIP_COLORS.secondaryText },
          ]}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={16} color={MENTORSHIP_COLORS.mutedForeground} />
      </Pressable>
    </View>
  );
}

function SelectModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  styles,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue: string | null;
  onSelect: (option: SelectOption) => void;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          {options.length === 0 ? (
            <Text style={styles.modalEmptyText}>No options available.</Text>
          ) : (
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              renderItem={({ item }) => {
                const isSelected = item.value === selectedValue;
                return (
                  <Pressable
                    onPress={() => onSelect(item)}
                    style={({ pressed }) => [
                      styles.modalOption,
                      pressed && styles.modalOptionPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && { color: MENTORSHIP_COLORS.primary },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: MENTORSHIP_COLORS.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -16,
      overflow: "hidden",
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      gap: spacing.xs,
    },
    title: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    card: {
      backgroundColor: MENTORSHIP_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      padding: spacing.md,
      gap: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    sectionHeader: {
      gap: spacing.xs,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    sectionSubtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    stateContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    stateText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    errorCard: {
      backgroundColor: `${MENTORSHIP_COLORS.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: `${MENTORSHIP_COLORS.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      backgroundColor: MENTORSHIP_COLORS.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    inlineLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    inlineLoadingText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primaryText,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    selectField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
    },
    input: {
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    textArea: {
      minHeight: 90,
    },
    primaryButton: {
      backgroundColor: MENTORSHIP_COLORS.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      color: MENTORSHIP_COLORS.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    ghostButton: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.card,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: MENTORSHIP_COLORS.primaryText,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    pairsList: {
      gap: spacing.md,
    },
    pairHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    pairColumn: {
      flex: 1,
    },
    pairColumnRight: {
      flex: 1,
      alignItems: "flex-end",
    },
    pairCenter: {
      alignItems: "center",
      gap: spacing.xs,
    },
    pairName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    pairRole: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      textTransform: "capitalize",
    },
    deleteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: `${MENTORSHIP_COLORS.error}14`,
    },
    deleteButtonPressed: {
      opacity: 0.85,
    },
    deleteButtonText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.error,
    },
    logList: {
      gap: spacing.sm,
    },
    logItem: {
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    logMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    logMetaText: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    logNotes: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primaryText,
    },
    logMetric: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    logFormContainer: {
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: MENTORSHIP_COLORS.border,
    },
    logForm: {
      gap: spacing.sm,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      borderRadius: borderRadius.md,
      overflow: "hidden",
      backgroundColor: MENTORSHIP_COLORS.card,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      padding: spacing.md,
    },
    modalSheet: {
      backgroundColor: MENTORSHIP_COLORS.card,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      maxHeight: "70%",
      gap: spacing.sm,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    modalCloseText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primary,
      fontWeight: fontWeight.semibold,
    },
    modalOption: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
    },
    modalOptionPressed: {
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
    },
    modalOptionText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
    },
    modalDivider: {
      height: 1,
      backgroundColor: MENTORSHIP_COLORS.border,
    },
    modalEmptyText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
      paddingVertical: spacing.sm,
      textAlign: "center",
    },
  });
