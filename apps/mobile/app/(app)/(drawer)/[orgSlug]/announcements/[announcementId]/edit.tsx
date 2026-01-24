import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { Announcement } from "@teammeet/types";

type Audience = "all" | "active_members" | "members" | "alumni" | "individuals";

type TargetUser = {
  id: string;
  label: string;
};

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "all", label: "All Members" },
  { value: "active_members", label: "Active Members" },
  { value: "members", label: "Members" },
  { value: "alumni", label: "Alumni" },
  { value: "individuals", label: "Specific People" },
];

const EDIT_COLORS = {
  background: "#ffffff",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  inputBg: "#f8fafc",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBg: "#fee2e2",
};

export default function EditAnnouncementScreen() {
  const router = useRouter();
  const { announcementId } = useLocalSearchParams<{ announcementId: string }>();
  const { orgId, orgSlug } = useOrg();
  const styles = useMemo(() => createStyles(), []);

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loadingAnnouncement, setLoadingAnnouncement] = useState(true);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [audience, setAudience] = useState<Audience>("all");
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the announcement
  useEffect(() => {
    if (!announcementId || !orgId) {
      return;
    }

    setLoadingAnnouncement(true);
    supabase
      .from("announcements")
      .select("*")
      .eq("id", announcementId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError("Announcement not found");
          setLoadingAnnouncement(false);
          return;
        }
        setAnnouncement(data as Announcement);
        setTitle(data.title);
        setBody(data.body || "");
        setIsPinned(data.is_pinned || false);
        setIsPublished(!!data.published_at);
        setAudience((data.audience as Audience) || "all");
        setTargetUserIds(data.audience_user_ids || []);
        setLoadingAnnouncement(false);
      });
  }, [announcementId, orgId]);

  // Fetch users for "individuals" audience
  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      if (!orgId) return;
      setLoadingUsers(true);
      try {
        const { data, error: fetchError } = await supabase
          .from("user_organization_roles")
          .select("user_id, users(name,email)")
          .eq("organization_id", orgId)
          .eq("status", "active");

        if (fetchError) throw fetchError;

        const memberships =
          (data as Array<{
            user_id: string;
            users?: { name?: string | null; email?: string | null } | { name?: string | null; email?: string | null }[] | null;
          }> | null) || [];

        const options = memberships.map((m) => {
          const user = Array.isArray(m.users) ? m.users[0] : m.users;
          return {
            id: m.user_id,
            label: user?.name || user?.email || "User",
          };
        });

        if (isMounted) {
          setUserOptions(options);
        }
      } catch (e) {
        if (isMounted) {
          console.error("Failed to load users:", e);
        }
      } finally {
        if (isMounted) {
          setLoadingUsers(false);
        }
      }
    }

    loadUsers();

    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const toggleTargetUser = (userId: string) => {
    setTargetUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async () => {
    if (!orgId || !orgSlug || !announcement) {
      setError("Organization not loaded yet.");
      return;
    }

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (audience === "individuals" && targetUserIds.length === 0) {
      setError("Select at least one recipient.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const audienceUserIds = audience === "individuals" ? targetUserIds : null;

      const { error: updateError } = await supabase
        .from("announcements")
        .update({
          title: title.trim(),
          body: body.trim() || null,
          is_pinned: isPinned,
          published_at: isPublished ? (announcement.published_at || new Date().toISOString()) : null,
          audience,
          audience_user_ids: audienceUserIds,
          updated_at: new Date().toISOString(),
        })
        .eq("id", announcement.id);

      if (updateError) {
        throw updateError;
      }

      router.back();
    } catch (e) {
      setError((e as Error).message || "Failed to update announcement.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingAnnouncement) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={EDIT_COLORS.primaryCTA} />
      </View>
    );
  }

  if (!announcement) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error || "Announcement not found"}</Text>
        <TouchableOpacity style={styles.backButtonAlt} onPress={() => router.back()}>
          <Text style={styles.backButtonAltText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </TouchableOpacity>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Edit Announcement</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTextSmall}>{error}</Text>
          </View>
        )}

        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>Title *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Announcement title"
            placeholderTextColor={EDIT_COLORS.mutedText}
            style={styles.input}
          />
        </View>

        {/* Body */}
        <View style={styles.field}>
          <Text style={styles.label}>Body</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write your announcement..."
            placeholderTextColor={EDIT_COLORS.mutedText}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.textArea]}
          />
        </View>

        {/* Audience */}
        <View style={styles.field}>
          <Text style={styles.label}>Audience</Text>
          <View style={styles.optionsGrid}>
            {AUDIENCE_OPTIONS.map((option) => {
              const selected = audience === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setAudience(option.value)}
                  style={[
                    styles.optionButton,
                    selected && styles.optionButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      selected && styles.optionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Individual Recipients */}
        {audience === "individuals" && (
          <View style={styles.field}>
            <Text style={styles.label}>Select recipients</Text>
            {loadingUsers ? (
              <ActivityIndicator color={EDIT_COLORS.primaryCTA} />
            ) : (
              <View style={styles.recipientsList}>
                {userOptions.map((user) => {
                  const selected = targetUserIds.includes(user.id);
                  return (
                    <Pressable
                      key={user.id}
                      onPress={() => toggleTargetUser(user.id)}
                      style={[
                        styles.recipientItem,
                        selected && styles.recipientItemActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          selected && styles.checkboxActive,
                        ]}
                      />
                      <Text style={styles.recipientText}>{user.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Toggles */}
        <View style={styles.togglesSection}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Pin announcement</Text>
            <Switch
              value={isPinned}
              onValueChange={setIsPinned}
              trackColor={{ false: EDIT_COLORS.border, true: SEMANTIC.successLight }}
              thumbColor={isPinned ? SEMANTIC.success : EDIT_COLORS.inputBg}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelContainer}>
              <Text style={styles.toggleLabel}>Published</Text>
              <Text style={styles.toggleHint}>
                {isPublished ? "Visible to audience" : "Draft - not visible"}
              </Text>
            </View>
            <Switch
              value={isPublished}
              onValueChange={setIsPublished}
              trackColor={{ false: EDIT_COLORS.border, true: SEMANTIC.successLight }}
              thumbColor={isPublished ? SEMANTIC.success : EDIT_COLORS.inputBg}
            />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitButton, isSaving && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={EDIT_COLORS.primaryCTAText} size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: EDIT_COLORS.background,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    errorContainer: {
      padding: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: EDIT_COLORS.errorBg,
      marginBottom: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: EDIT_COLORS.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    errorTextSmall: {
      ...TYPOGRAPHY.bodySmall,
      color: EDIT_COLORS.error,
    },
    backButtonAlt: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: EDIT_COLORS.primaryCTA,
    },
    backButtonAltText: {
      ...TYPOGRAPHY.labelMedium,
      color: EDIT_COLORS.primaryCTAText,
    },
    field: {
      marginBottom: SPACING.md,
    },
    label: {
      ...TYPOGRAPHY.labelMedium,
      color: EDIT_COLORS.primaryText,
      marginBottom: SPACING.xs,
    },
    input: {
      backgroundColor: EDIT_COLORS.inputBg,
      borderWidth: 1,
      borderColor: EDIT_COLORS.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: EDIT_COLORS.primaryText,
    },
    textArea: {
      minHeight: 120,
      paddingTop: SPACING.sm,
    },
    optionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.sm,
    },
    optionButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: EDIT_COLORS.border,
      backgroundColor: EDIT_COLORS.inputBg,
    },
    optionButtonActive: {
      backgroundColor: SEMANTIC.success,
      borderColor: SEMANTIC.success,
    },
    optionText: {
      ...TYPOGRAPHY.labelSmall,
      color: EDIT_COLORS.primaryText,
    },
    optionTextActive: {
      color: "#ffffff",
    },
    recipientsList: {
      gap: SPACING.sm,
    },
    recipientItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: EDIT_COLORS.border,
      backgroundColor: EDIT_COLORS.inputBg,
    },
    recipientItemActive: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.successLight,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: EDIT_COLORS.mutedText,
      backgroundColor: "transparent",
    },
    checkboxActive: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.success,
    },
    recipientText: {
      ...TYPOGRAPHY.bodyMedium,
      color: EDIT_COLORS.primaryText,
    },
    togglesSection: {
      gap: SPACING.md,
      marginBottom: SPACING.md,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabelContainer: {
      flex: 1,
    },
    toggleLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: EDIT_COLORS.primaryText,
    },
    toggleHint: {
      ...TYPOGRAPHY.caption,
      color: EDIT_COLORS.mutedText,
      marginTop: 2,
    },
    actions: {
      flexDirection: "row",
      gap: SPACING.md,
      marginTop: SPACING.lg,
      paddingTop: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: EDIT_COLORS.border,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: EDIT_COLORS.inputBg,
      borderWidth: 1,
      borderColor: EDIT_COLORS.border,
      alignItems: "center",
    },
    cancelButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: EDIT_COLORS.primaryText,
    },
    submitButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      backgroundColor: EDIT_COLORS.primaryCTA,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: EDIT_COLORS.primaryCTAText,
    },
  });
