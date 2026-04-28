import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { memberDisplayLabel } from "@teammeet/core";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import { loadPairableOrgMembers } from "@/hooks/useMentorship";
import type { SelectOption } from "@/types/mentorship";

export function MentorshipAdminPanel({
  orgId,
  onRefresh,
}: {
  orgId: string;
  onRefresh: () => void;
}) {
  const styles = useThemedStyles(createStyles);
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
      try {
        const { mentors: mentorList, mentees: menteeList } =
          await loadPairableOrgMembers(orgId);

        if (!isMounted) return;

        setMentors(
          mentorList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
        setMentees(
          menteeList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
      } catch (loadError) {
        if (!isMounted) return;
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load org members."
        );
      }

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
          channel: "all",
          audience: "both",
          targetUserIds: [mentorId, menteeId],
          category: "mentorship",
          pushType: "mentorship",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.warn(
          "Failed to send mentorship pairing notification:",
          payload?.error || response.status
        );
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
          <ActivityIndicator color={styles.loadingColor.color} />
          <Text style={styles.inlineLoadingText}>Loading mentorship controls...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Create pair</Text>
        <Text style={styles.sectionSubtitle}>
          Pair an eligible mentor with an active member.
        </Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SelectField
        label="Mentor"
        value={mentors.find((m) => m.value === mentorId)?.label || ""}
        placeholder="Select mentor"
        onPress={() => setActiveSelect("mentor")}
      />
      <SelectField
        label="Mentee"
        value={mentees.find((m) => m.value === menteeId)?.label || ""}
        placeholder="Select mentee"
        onPress={() => setActiveSelect("mentee")}
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
          <ActivityIndicator color={styles.primaryButtonText.color} />
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
      />
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
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
    sectionHeader: {
      gap: SPACING.xs,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: n.foreground,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: n.muted,
    },
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    inlineLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    inlineLoadingText: {
      fontSize: 14,
      color: n.muted,
    },
    loadingColor: {
      color: s.success,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      color: n.surface,
      fontSize: 16,
      fontWeight: "600",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
