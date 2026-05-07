import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  TextInput,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Building2, ChevronDown, ChevronRight, Palette } from "lucide-react-native";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize, fontWeight, spacing } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface Props {
  org: { name: string; slug: string; logo_url: string | null; primary_color: string | null; secondary_color: string | null } | null;
  orgLoading: boolean;
  updateName: (name: string) => Promise<{ success: boolean; error?: string }>;
  isAdmin: boolean;
  orgSlug?: string;
}

export function SettingsOrganizationSection({ org, orgLoading, updateName, isAdmin, orgSlug }: Props) {
  const router = useRouter();
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);
  const [editedName, setEditedName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setEditedName(org.name);
    }
  }, [org]);

  const styles = useThemedStyles((n, s) => ({
    fieldGroup: {
      marginBottom: spacing.md,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.base,
      color: n.foreground,
      marginBottom: 12,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: s.error,
      marginBottom: spacing.sm,
    },
    button: {
      backgroundColor: s.success,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: "#ffffff",
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    customizeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      paddingVertical: 8,
    },
    customizeLabel: {
      flex: 1,
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: n.foreground,
    },
  }));

  if (!isAdmin) return null;

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === org?.name) return;
    setNameSaving(true);
    setNameError(null);
    const result = await updateName(editedName);
    if (!result.success) {
      setNameError(result.error || "Failed to update name");
    }
    setNameSaving(false);
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Building2 size={20} color={colors.muted} />
          <Text style={baseStyles.sectionTitle}>Organization</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={baseStyles.card}>
          {orgLoading ? (
            <View style={baseStyles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Organization Name</Text>
                <TextInput
                  style={styles.input}
                  value={editedName}
                  onChangeText={setEditedName}
                  placeholder="Organization name"
                  placeholderTextColor={colors.mutedForeground}
                />
                {nameError && <Text style={styles.errorText}>{nameError}</Text>}
                <Pressable
                  style={[styles.button, editedName === org?.name && styles.buttonDisabled]}
                  onPress={handleSaveName}
                  disabled={nameSaving || editedName === org?.name}
                >
                  {nameSaving ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Save Name</Text>
                  )}
                </Pressable>
              </View>

              <View style={baseStyles.divider} />

              <Pressable
                style={styles.customizeRow}
                onPress={() => {
                  if (orgSlug) {
                    router.push(`/(app)/${orgSlug}/settings/customization`);
                  }
                }}
              >
                <Palette size={20} color={colors.muted} />
                <Text style={styles.customizeLabel}>Customize</Text>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}
