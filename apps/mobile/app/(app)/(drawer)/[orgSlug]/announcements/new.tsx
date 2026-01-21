import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { fetchWithAuth } from "@/lib/web-api";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";

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

export default function NewAnnouncementScreen() {
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const { colors } = useOrgTheme();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [audience, setAudience] = useState<Audience>("all");
  const [sendNotification, setSendNotification] = useState(true);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError((e as Error).message);
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

  const notificationAudience = useMemo(() => {
    if (audience === "all") return "both";
    if (audience === "active_members") return "members";
    if (audience === "individuals") return "both";
    return audience;
  }, [audience]);

  const toggleTargetUser = (userId: string) => {
    setTargetUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async () => {
    if (!orgId || !orgSlug) {
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
      const { data: userData } = await supabase.auth.getUser();
      const createdByUserId = userData.user?.id || null;
      const audienceUserIds = audience === "individuals" ? targetUserIds : null;

      const { data: announcement, error: insertError } = await supabase
        .from("announcements")
        .insert({
          organization_id: orgId,
          title: title.trim(),
          body: body.trim() || null,
          is_pinned: isPinned,
          published_at: new Date().toISOString(),
          created_by_user_id: createdByUserId,
          audience,
          audience_user_ids: audienceUserIds,
        })
        .select()
        .single();

      if (insertError || !announcement) {
        throw insertError || new Error("Failed to create announcement.");
      }

      if (sendNotification) {
        try {
          const response = await fetchWithAuth("/api/notifications/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              announcementId: announcement.id,
              channel: "email,push",
              audience: notificationAudience,
            }),
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            console.warn("Failed to send notification:", data?.error || response.status);
          }
        } catch (notifyError) {
          console.warn("Failed to send notification:", notifyError);
        }
      }

      router.push(`/(app)/${orgSlug}/(tabs)/announcements`);
    } catch (e) {
      setError((e as Error).message || "Failed to create announcement.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.primary }}
      contentContainerStyle={{
        padding: spacing.md,
        gap: spacing.lg,
      }}
    >
      {error && (
        <View
          style={{
            backgroundColor: `${colors.error}20`,
            borderRadius: borderRadius.md,
            padding: spacing.sm,
          }}
        >
          <Text selectable style={{ color: colors.error, fontSize: fontSize.sm }}>
            {error}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Team Meeting Rescheduled"
          placeholderTextColor={colors.secondaryForeground}
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Body</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Write your announcement..."
          placeholderTextColor={colors.secondaryForeground}
          multiline
          textAlignVertical="top"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
            minHeight: 140,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Audience</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {AUDIENCE_OPTIONS.map((option) => {
            const selected = audience === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setAudience(option.value)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primaryLight : colors.card,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    color: selected ? colors.primaryForeground : colors.foreground,
                    fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {audience === "individuals" && (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Select recipients</Text>
          {loadingUsers ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {userOptions.map((user) => {
                const selected = targetUserIds.includes(user.id);
                return (
                  <Pressable
                    key={user.id}
                    onPress={() => toggleTargetUser(user.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      padding: spacing.sm,
                      borderRadius: borderRadius.md,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primaryLight : colors.card,
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2,
                        borderColor: selected ? colors.primary : colors.mutedForeground,
                        backgroundColor: selected ? colors.primary : "transparent",
                      }}
                    />
                    <Text selectable style={{ fontSize: fontSize.base, color: colors.foreground }}>
                      {user.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={{ gap: spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontSize: fontSize.base, color: colors.foreground }}>
            Pin announcement
          </Text>
          <Switch
            value={isPinned}
            onValueChange={setIsPinned}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={isPinned ? colors.primary : colors.card}
          />
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ fontSize: fontSize.base, color: colors.foreground }}>
            Send notifications
          </Text>
          <Switch
            value={sendNotification}
            onValueChange={setSendNotification}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={sendNotification ? colors.primary : colors.card}
          />
        </View>
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={isSaving}
        style={{
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: spacing.sm,
          alignItems: "center",
          opacity: isSaving ? 0.7 : 1,
        }}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>
            Post Announcement
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
