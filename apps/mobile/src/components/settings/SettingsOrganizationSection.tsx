import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { Building2, ChevronDown } from "lucide-react-native";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { type SettingsColors } from "./settingsColors";

interface Props {
  orgId: string | null;
  isAdmin: boolean;
  colors: SettingsColors;
}

const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const fontSize = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20 };
const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export function SettingsOrganizationSection({ orgId, isAdmin, colors }: Props) {
  const { org, loading: orgLoading, updateName } = useOrgSettings(orgId);

  const [expanded, setExpanded] = useState(true);
  const [editedName, setEditedName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setEditedName(org.name);
    }
  }, [org]);

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

  const styles = createStyles(colors);

  return (
    <View style={styles.section}>
      <Pressable
        style={({ pressed }) => [styles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((prev) => !prev)}
      >
        <View style={styles.sectionHeaderLeft}>
          <Building2 size={20} color={colors.muted} />
          <Text style={styles.sectionTitle}>Organization</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.card}>
          {orgLoading ? (
            <View style={styles.loadingContainer}>
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

              <View style={styles.divider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Branding</Text>
                <View style={[styles.brandingPreview, { backgroundColor: org?.primary_color || colors.primary }]}>
                  {org?.logo_url ? (
                    <Image source={org.logo_url} style={styles.logoPreview} contentFit="contain" transition={200} />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Building2 size={24} color="#fff" />
                    </View>
                  )}
                  <View>
                    <Text style={styles.brandingName}>{org?.name}</Text>
                    <Text style={styles.brandingSlug}>/{org?.slug}</Text>
                  </View>
                </View>
                <View style={styles.colorRow}>
                  <View style={styles.colorItem}>
                    <View style={[styles.colorSwatch, { backgroundColor: org?.primary_color || colors.primary }]} />
                    <Text style={styles.colorLabel}>Primary</Text>
                  </View>
                  <View style={styles.colorItem}>
                    <View style={[styles.colorSwatch, { backgroundColor: org?.secondary_color || colors.secondary }]} />
                    <Text style={styles.colorLabel}>Secondary</Text>
                  </View>
                </View>
                <Text style={styles.hintText}>
                  To change logo and colors, visit settings on the web.
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: SettingsColors) =>
  StyleSheet.create({
    section: {
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    sectionHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: spacing.md,
      borderCurve: "continuous",
    },
    loadingContainer: {
      padding: 24,
      alignItems: "center",
    },
    fieldGroup: {
      marginBottom: spacing.md,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.base,
      color: colors.foreground,
      marginBottom: 12,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.error,
      marginBottom: spacing.sm,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing.md,
    },
    hintText: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: spacing.sm,
    },
    brandingPreview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: spacing.md,
      borderRadius: 12,
      marginBottom: 12,
    },
    logoPreview: {
      width: 48,
      height: 48,
      borderRadius: 12,
    },
    logoPlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    brandingName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#fff",
    },
    brandingSlug: {
      fontSize: fontSize.sm,
      color: "rgba(255,255,255,0.8)",
    },
    colorRow: {
      flexDirection: "row",
      gap: 24,
    },
    colorItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    colorSwatch: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    colorLabel: {
      fontSize: fontSize.sm,
      color: colors.muted,
    },
  });
