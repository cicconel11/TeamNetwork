import React, { useEffect, useState } from "react";
import { View, Text, Switch, ActivityIndicator, StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

export function MenteeStatusToggle({ orgId }: { orgId: string }) {
  const styles = useThemedStyles(createStyles);
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
          <ActivityIndicator color={styles.loadingColor.color} />
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
              trackColor={{
                false: styles.trackOff.color,
                true: styles.trackOn.color,
              }}
              thumbColor={
                status === "active"
                  ? styles.thumbOn.color
                  : styles.thumbOff.color
              }
            />
          </View>
        </>
      )}
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
    errorText: {
      fontSize: 14,
      color: s.error,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: 14,
      color: n.foreground,
    },
    trackOff: {
      color: n.border,
    },
    trackOn: {
      color: s.success,
    },
    thumbOn: {
      color: s.success,
    },
    thumbOff: {
      color: n.surface,
    },
  });
