import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { memberDisplayLabel, normalizeMentorshipStatus } from "@teammeet/core";
import { useAuth } from "@/hooks/useAuth";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import { loadPairableOrgMembers } from "@/hooks/useMentorship";
import { STATUS_OPTIONS } from "@/types/mentorship";
import type { MentorshipStatus, SelectOption } from "@/types/mentorship";

export function MentorPairManager({
  orgId,
  onRefresh,
}: {
  orgId: string;
  onRefresh: () => void;
}) {
  const styles = useThemedStyles(createStyles);
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

      try {
        const { mentees: menteeList } = await loadPairableOrgMembers(orgId);

        if (!isMounted) return;

        setAvailableMentees(
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
        setIsLoading(false);
        return;
      }

      const { data: pair } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("mentor_user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (pair) {
        setPairId(pair.id);
        setCurrentMenteeId(pair.mentee_user_id);
        setInitialMenteeId(pair.mentee_user_id);
        setStatus(normalizeMentorshipStatus(pair.status));
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
          .is("deleted_at", null)
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
            channel: "all",
            audience: "both",
            targetUserIds: [mentorId, currentMenteeId],
            category: "mentorship",
            pushType: "mentorship",
          }),
        });

        if (!response.ok) {
          const notifPayload = await response.json().catch(() => ({}));
          console.warn(
            "Failed to send mentorship pairing notification:",
            notifPayload?.error || response.status
          );
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
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", pairId)
              .eq("mentor_user_id", mentorId)
              .is("deleted_at", null);

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
          <ActivityIndicator color={styles.loadingColor.color} />
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
      />
      <SelectField
        label="Status"
        value={STATUS_OPTIONS.find((opt) => opt.value === status)?.label || ""}
        placeholder="Select status"
        onPress={() => setActiveSelect("status")}
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
            <ActivityIndicator color={styles.primaryButtonText.color} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {pairId ? "Update mentee" : "Assign mentee"}
            </Text>
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
    buttonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: SPACING.sm,
      flexWrap: "wrap",
    },
    ghostButton: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: n.foreground,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
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
