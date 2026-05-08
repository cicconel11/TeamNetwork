import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft, X, Plus } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { Avatar } from "@/components/ui/Avatar";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { MOBILE_CHAT_MEMBER_DIRECTORY_ROLES } from "@/lib/chat-helpers";

type OrgMember = {
  user_id: string;
  role: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type OrgMemberRow = {
  user_id: string;
  role: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
};

export default function NewChatScreen() {
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const isMountedRef = useRef(true);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      padding: SPACING.md,
      gap: SPACING.lg,
    },
    fieldGroup: {
      gap: SPACING.sm,
    },
    label: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    helperText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    input: {
      backgroundColor: n.divider,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      minHeight: 44,
    },
    textArea: {
      minHeight: 96,
      paddingTop: SPACING.sm,
      textAlignVertical: "top" as const,
    },
    chipsRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.xs,
    },
    chip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xxs,
      backgroundColor: s.success,
      borderRadius: RADIUS.full,
      paddingVertical: 4,
      paddingLeft: SPACING.sm,
      paddingRight: SPACING.xs,
    },
    chipText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.surface,
      fontWeight: "600" as const,
    },
    chipRemove: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: "rgba(255,255,255,0.25)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    memberList: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      backgroundColor: n.surface,
      overflow: "hidden" as const,
      maxHeight: 320,
    },
    memberRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: n.divider,
    },
    memberRowPressed: {
      backgroundColor: n.divider,
    },
    memberInfo: {
      flex: 1,
      minWidth: 0,
    },
    memberName: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    memberMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    memberAddIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: n.divider,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    listEmpty: {
      padding: SPACING.md,
      alignItems: "center" as const,
    },
    listEmptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    toggleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    toggleText: {
      flex: 1,
      gap: 2,
    },
    toggleTitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    toggleHelp: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    errorBanner: {
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderLeftWidth: 3,
      borderLeftColor: s.error,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    submitButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.lg,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      minHeight: 48,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.surface,
      fontWeight: "600" as const,
    },
    gateContainer: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: SPACING.lg,
      gap: SPACING.sm,
    },
    gateTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    gateText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      textAlign: "center" as const,
    },
  }));

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);

  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<OrgMember[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;
    (async () => {
      setLoadingMembers(true);
      try {
        const { data, error: queryError } = await supabase
          .from("user_organization_roles")
          .select("user_id, role, user:users(id, name, email, avatar_url)")
          .eq("organization_id", orgId)
          .eq("status", "active")
          .in("role", [...MOBILE_CHAT_MEMBER_DIRECTORY_ROLES]);

        if (queryError) throw queryError;
        if (cancelled || !isMountedRef.current) return;

        const rows = (data || []) as OrgMemberRow[];
        const members: OrgMember[] = rows
          .filter((row) => row.user_id && row.user_id !== currentUserId)
          .map((row) => ({
            user_id: row.user_id,
            role: row.role,
            name: row.user?.name ?? null,
            email: row.user?.email ?? null,
            avatar_url: row.user?.avatar_url ?? null,
          }))
          .sort((a, b) =>
            (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")
          );

        setOrgMembers(members);
      } catch (e) {
        if (!cancelled && isMountedRef.current) {
          setOrgMembers([]);
        }
      } finally {
        if (!cancelled && isMountedRef.current) setLoadingMembers(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, currentUserId]);

  const filteredMembers = useMemo(() => {
    const selectedIds = new Set(selectedMembers.map((m) => m.user_id));
    const available = orgMembers.filter((m) => !selectedIds.has(m.user_id));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return available;
    return available.filter((m) => {
      const name = (m.name ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      const role = (m.role ?? "").toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q);
    });
  }, [orgMembers, selectedMembers, searchQuery]);

  const toggleMember = useCallback((member: OrgMember) => {
    setSelectedMembers((prev) => {
      if (prev.some((m) => m.user_id === member.user_id)) {
        return prev.filter((m) => m.user_id !== member.user_id);
      }
      return [...prev, member];
    });
  }, []);

  const removeSelected = useCallback((userId: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Group name is required");
      return;
    }
    if (!orgId || !currentUserId) {
      setError("Missing organization or user context");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const { data: group, error: createError } = await supabase
        .from("chat_groups")
        .insert({
          organization_id: orgId,
          name: trimmedName,
          description: description.trim() || null,
          is_default: isDefault,
          require_approval: requireApproval,
          created_by: currentUserId,
        })
        .select()
        .single();

      if (createError || !group) {
        throw createError ?? new Error("Failed to create group");
      }

      const memberInserts: Array<{
        chat_group_id: string;
        user_id: string;
        organization_id: string;
        role: "admin" | "moderator" | "member";
        added_by: string | null;
      }> = [
        {
          chat_group_id: group.id,
          user_id: currentUserId,
          organization_id: orgId,
          role: "admin",
          added_by: currentUserId,
        },
      ];

      for (const member of selectedMembers) {
        if (member.user_id !== currentUserId) {
          memberInserts.push({
            chat_group_id: group.id,
            user_id: member.user_id,
            organization_id: orgId,
            role: "member",
            added_by: currentUserId,
          });
        }
      }

      const { error: membersError } = await supabase
        .from("chat_group_members")
        .insert(memberInserts);

      if (membersError) throw membersError;

      if (isMountedRef.current) {
        router.replace(`/(app)/${orgSlug}/chat/${group.id}`);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message || "Failed to create chat");
        setSubmitting(false);
      }
    }
  }, [
    submitting,
    name,
    description,
    isDefault,
    requireApproval,
    orgId,
    currentUserId,
    selectedMembers,
    router,
    orgSlug,
  ]);

  const renderHeader = () => (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={APP_CHROME.headerTitle} />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>New Chat</Text>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.gateContainer}>
          <Text style={styles.gateTitle}>Admins only</Text>
          <Text style={styles.gateText}>
            Only organization admins can create new chat groups.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Group name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Coaches, Parents, Captains"
              editable={!submitting}
              maxLength={120}
              returnKeyType="next"
              autoFocus
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="What is this group for?"
              editable={!submitting}
              multiline
              maxLength={500}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Add members
              {selectedMembers.length > 0
                ? ` (${selectedMembers.length} selected)`
                : ""}
            </Text>
            <Text style={styles.helperText}>
              You will be added as an admin automatically.
            </Text>

            {selectedMembers.length > 0 && (
              <View style={styles.chipsRow}>
                {selectedMembers.map((member) => (
                  <View key={member.user_id} style={styles.chip}>
                    <Text style={styles.chipText}>
                      {member.name ?? member.email ?? "Member"}
                    </Text>
                    <Pressable
                      onPress={() => removeSelected(member.user_id)}
                      style={styles.chipRemove}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${member.name ?? "member"}`}
                    >
                      <X size={12} color="#ffffff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <TextInput
              style={styles.input}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search members by name, email, or role"
              editable={!submitting}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.memberList}>
              {loadingMembers ? (
                <View style={styles.listEmpty}>
                  <ActivityIndicator size="small" />
                </View>
              ) : filteredMembers.length === 0 ? (
                <View style={styles.listEmpty}>
                  <Text style={styles.listEmptyText}>
                    {searchQuery
                      ? "No members match your search"
                      : "No more members to add"}
                  </Text>
                </View>
              ) : (
                filteredMembers.map((member) => (
                  <Pressable
                    key={member.user_id}
                    onPress={() => toggleMember(member)}
                    style={({ pressed }) => [
                      styles.memberRow,
                      pressed && styles.memberRowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${member.name ?? "member"}`}
                  >
                    <Avatar
                      uri={member.avatar_url}
                      name={member.name ?? member.email ?? "?"}
                      size="sm"
                    />
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {member.name ?? member.email ?? "Member"}
                      </Text>
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        {member.role || member.email || "Member"}
                      </Text>
                    </View>
                    <View style={styles.memberAddIcon}>
                      <Plus size={16} />
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Default group</Text>
                <Text style={styles.toggleHelp}>
                  New members are automatically added to this group.
                </Text>
              </View>
              <Switch
                value={isDefault}
                onValueChange={setIsDefault}
                disabled={submitting}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Require approval</Text>
                <Text style={styles.toggleHelp}>
                  Messages from regular members must be approved before they
                  appear.
                </Text>
              </View>
              <Switch
                value={requireApproval}
                onValueChange={setRequireApproval}
                disabled={submitting}
              />
            </View>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.submitButton,
              submitting && styles.submitButtonDisabled,
              pressed && !submitting && styles.submitButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create chat group"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>Create Chat</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
