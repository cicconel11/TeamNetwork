import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Switch,
} from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SelectField, SelectModal } from "@/components/ui/SelectField";
import {
  TIMEZONE_OPTIONS,
  LANGUAGE_OPTIONS,
  COLOR_PRESETS,
  PERMISSION_CARDS,
  PERMISSION_ROLE_OPTIONS,
  HEX_COLOR_REGEX,
} from "@/lib/customization-constants";
import type { SelectOption } from "@/types/mentorship";
import {
  ChevronLeft,
  Building2,
  Check,
  Camera,
} from "lucide-react-native";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ---------------------------------------------------------------------------
// Permission Card (local component to avoid repeating across 4 cards)
// ---------------------------------------------------------------------------

function PermissionCard({
  title,
  subtitle,
  field,
  currentRoles,
  onSave,
  index,
  styles,
  neutral,
}: {
  title: string;
  subtitle: string;
  field: string;
  currentRoles: string[];
  onSave: (field: string, roles: string[]) => Promise<void>;
  index: number;
  styles: ReturnType<typeof useCustomizationStyles>;
  neutral: ReturnType<typeof useAppColorScheme>["neutral"];
}) {
  const [localRoles, setLocalRoles] = useState<string[]>(currentRoles);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalRoles(currentRoles);
  }, [currentRoles]);

  const hasChanges =
    JSON.stringify([...localRoles].sort()) !==
    JSON.stringify([...currentRoles].sort());

  const toggleRole = (role: string) => {
    if (role === "admin") return;
    setLocalRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(field, localRoles);
    setSaving(false);
  };

  return (
    <Animated.View
      entering={FadeInDown.delay((4 + index) * 60).duration(300)}
      style={styles.card}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{subtitle}</Text>
      <View style={styles.permissionRows}>
        {PERMISSION_ROLE_OPTIONS.map((opt) => {
          const checked = opt.value === "admin" || localRoles.includes(opt.value);
          const disabled = opt.locked;
          return (
            <Animated.View key={opt.value} layout={LinearTransition}>
              <Pressable
                style={styles.checkboxRow}
                onPress={() => toggleRole(opt.value)}
                disabled={disabled}
              >
                <View
                  style={[
                    styles.checkbox,
                    checked && styles.checkboxChecked,
                    disabled && styles.checkboxDisabled,
                  ]}
                >
                  {checked && <Check size={14} color={neutral.surface} />}
                </View>
                <Text style={styles.checkboxLabel}>{opt.label}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      <Pressable
        style={[styles.saveButton, (!hasChanges || saving) && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!hasChanges || saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={neutral.surface} />
        ) : (
          <Text style={styles.saveButtonText}>Save Permissions</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CustomizationScreen() {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useCustomizationStyles();

  const { org, loading: orgLoading, updateBranding, updateSettings, refetch } = useOrgSettings(orgId ?? null);

  // Role check (same pattern as navigation.tsx)
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgId || !user) {
        setRoleLoading(false);
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .single();

        if (roleData && isMounted) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);
        }
      } catch (e) {
        captureException(e as Error, { screen: "Customization", context: "fetchRole", orgId });
      } finally {
        if (isMounted) {
          setRoleLoading(false);
        }
      }
    }

    fetchRole();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  // Local state for color inputs
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);

  // Select modal state
  const [timezoneModalVisible, setTimezoneModalVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  // Sync color inputs when org data loads
  useEffect(() => {
    if (org) {
      setPrimaryColor(org.primary_color ?? "");
      setSecondaryColor(org.secondary_color ?? "");
    }
  }, [org]);

  // Which color field the palette targets
  const [activeColorField, setActiveColorField] = useState<"primary" | "secondary">("primary");

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleLogoPick = useCallback(async () => {
    if (!org) return;
    await Haptics.selectionAsync();

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? asset.type ?? "image/jpeg";
    const fileSize = asset.fileSize ?? 0;

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      Alert.alert("Invalid File", "Please select a PNG, JPG, WebP, or GIF image.");
      return;
    }

    if (fileSize > MAX_FILE_SIZE) {
      Alert.alert("File Too Large", "Logo must be under 5MB.");
      return;
    }

    setLogoUploading(true);
    const ext = mimeType.split("/")[1] ?? "jpeg";
    const res = await updateBranding({
      logo: { uri: asset.uri, name: `logo.${ext}`, type: mimeType },
    });

    if (!res.success) {
      Alert.alert("Upload Failed", res.error ?? "Unable to upload logo.");
    }
    setLogoUploading(false);
  }, [org, updateBranding]);

  const handleColorBlur = useCallback(
    async (field: "primary" | "secondary") => {
      const value = field === "primary" ? primaryColor : secondaryColor;
      const currentValue = field === "primary" ? org?.primary_color : org?.secondary_color;

      if (!HEX_COLOR_REGEX.test(value) || value === currentValue) return;

      const colorKey = field === "primary" ? "primaryColor" : "secondaryColor";
      const res = await updateBranding({ [colorKey]: value });
      if (!res.success) {
        Alert.alert("Error", res.error ?? "Unable to update color.");
      }
    },
    [primaryColor, secondaryColor, org, updateBranding]
  );

  const handlePresetTap = useCallback(
    async (hex: string) => {
      await Haptics.selectionAsync();
      if (activeColorField === "primary") {
        setPrimaryColor(hex);
        await updateBranding({ primaryColor: hex });
      } else {
        setSecondaryColor(hex);
        await updateBranding({ secondaryColor: hex });
      }
    },
    [activeColorField, updateBranding]
  );

  const handleTimezoneSelect = useCallback(
    async (option: SelectOption) => {
      setTimezoneModalVisible(false);
      await updateSettings({ timezone: option.value });
    },
    [updateSettings]
  );

  const handleLanguageSelect = useCallback(
    async (option: SelectOption) => {
      setLanguageModalVisible(false);
      await updateSettings({ default_language: option.value });
    },
    [updateSettings]
  );

  const handleLinkedInToggle = useCallback(
    async (value: boolean) => {
      const res = await updateSettings({ linkedin_resync_enabled: value });
      if (!res.success) {
        Alert.alert("Error", res.error ?? "Unable to update setting.");
        // Refetch to revert optimistic update
        await refetch();
      }
    },
    [updateSettings, refetch]
  );

  const handlePermissionSave = useCallback(
    async (field: string, roles: string[]) => {
      const rolesWithAdmin = Array.from(new Set(["admin", ...roles]));
      const res = await updateSettings({ [field]: rolesWithAdmin });
      if (res.success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Error", res.error ?? "Unable to update permissions.");
      }
    },
    [updateSettings]
  );

  // ---------------------------------------------------------------------------
  // Header (shared across loading/denied/main states)
  // ---------------------------------------------------------------------------

  const header = (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]}>
        <View style={styles.headerContent}>
          <Pressable onPress={() => router.replace(`/(app)/${orgSlug}/settings`)} style={styles.backButton}>
            <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
          </Pressable>
          <Text style={styles.headerTitle}>Customization</Text>
          <View style={styles.headerSpacer} />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  // Loading state
  if (roleLoading || orgLoading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={semantic.success} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  // Non-admin
  if (!isAdmin) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.deniedTitle}>Admin Access Required</Text>
            <Text style={styles.deniedText}>
              You need admin permissions to manage customization settings.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Resolve display labels
  const timezoneLabel =
    TIMEZONE_OPTIONS.find((o) => o.value === org?.timezone)?.label ?? org?.timezone ?? "";
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.value === org?.default_language)?.label ?? org?.default_language ?? "";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.container}>
      {header}
      <View style={styles.contentSheet}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Card 1: Branding */}
          <Animated.View entering={FadeInDown.delay(0).duration(300)} style={styles.card}>
            <Text style={styles.cardTitle}>Branding</Text>

            {/* Logo */}
            <View style={styles.logoSection}>
              <Pressable onPress={handleLogoPick} style={styles.logoTouchable}>
                {logoUploading ? (
                  <Animated.View style={styles.logoPlaceholder}>
                    <ActivityIndicator size="small" color="#fff" />
                  </Animated.View>
                ) : org?.logo_url ? (
                  <Image
                    source={org.logo_url}
                    style={styles.logoImage}
                    contentFit="contain"
                    transition={200}
                  />
                ) : (
                  <View style={styles.logoPlaceholder}>
                    <Building2 size={28} color="#fff" />
                  </View>
                )}
                <View style={styles.logoCameraBadge}>
                  <Camera size={12} color="#fff" />
                </View>
              </Pressable>
              <Text style={styles.logoHint}>Tap to change logo</Text>
            </View>

            {/* Primary Color */}
            <View style={styles.colorFieldGroup}>
              <Text style={styles.fieldLabel}>Primary Color</Text>
              <View style={styles.colorInputRow}>
                <View
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: HEX_COLOR_REGEX.test(primaryColor) ? primaryColor : neutral.border },
                  ]}
                />
                <TextInput
                  style={styles.colorInput}
                  value={primaryColor}
                  onChangeText={setPrimaryColor}
                  onBlur={() => handleColorBlur("primary")}
                  onFocus={() => setActiveColorField("primary")}
                  placeholder="#1e3a5f"
                  placeholderTextColor={neutral.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={7}
                />
              </View>
              <Text selectable style={styles.hexDisplay}>{primaryColor || "Not set"}</Text>
            </View>

            {/* Secondary Color */}
            <View style={styles.colorFieldGroup}>
              <Text style={styles.fieldLabel}>Secondary Color</Text>
              <View style={styles.colorInputRow}>
                <View
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: HEX_COLOR_REGEX.test(secondaryColor) ? secondaryColor : neutral.border },
                  ]}
                />
                <TextInput
                  style={styles.colorInput}
                  value={secondaryColor}
                  onChangeText={setSecondaryColor}
                  onBlur={() => handleColorBlur("secondary")}
                  onFocus={() => setActiveColorField("secondary")}
                  placeholder="#0f172a"
                  placeholderTextColor={neutral.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={7}
                />
              </View>
              <Text selectable style={styles.hexDisplay}>{secondaryColor || "Not set"}</Text>
            </View>

            {/* Preset Palette */}
            <View style={styles.paletteSection}>
              <Text style={styles.fieldLabel}>
                Quick palette ({activeColorField === "primary" ? "Primary" : "Secondary"})
              </Text>
              <View style={styles.paletteRow}>
                {COLOR_PRESETS.map((hex) => (
                  <Pressable key={hex} onPress={() => handlePresetTap(hex)}>
                    <View style={[styles.paletteSwatch, { backgroundColor: hex }]} />
                  </Pressable>
                ))}
              </View>
            </View>
          </Animated.View>

          {/* Card 2: Localization */}
          <Animated.View entering={FadeInDown.delay(60).duration(300)} style={styles.card}>
            <Text style={styles.cardTitle}>Localization</Text>

            <SelectField
              label="Timezone"
              value={timezoneLabel}
              placeholder="Select timezone"
              onPress={() => setTimezoneModalVisible(true)}
            />
            <Text selectable style={styles.selectValueDisplay}>{org?.timezone ?? ""}</Text>

            <View style={styles.localizationGap} />

            <SelectField
              label="Language"
              value={languageLabel}
              placeholder="Select language"
              onPress={() => setLanguageModalVisible(true)}
            />
            <Text selectable style={styles.selectValueDisplay}>{org?.default_language ?? ""}</Text>
          </Animated.View>

          {/* Card 3: LinkedIn Profile Sync */}
          <Animated.View entering={FadeInDown.delay(120).duration(300)} style={styles.card}>
            <Text style={styles.cardTitle}>LinkedIn Profile Sync</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchTextContainer}>
                <Text style={styles.switchLabel}>Enable LinkedIn Resync</Text>
                <Text style={styles.switchDescription}>
                  Allow members to resync their LinkedIn profile data.
                </Text>
              </View>
              <Switch
                value={org?.linkedin_resync_enabled ?? false}
                onValueChange={handleLinkedInToggle}
                trackColor={{ false: neutral.border, true: semantic.success }}
              />
            </View>
          </Animated.View>

          {/* Cards 4-7: Permission Roles */}
          {PERMISSION_CARDS.map((card, index) => (
            <PermissionCard
              key={card.field}
              title={card.title}
              subtitle={card.subtitle}
              field={card.field}
              currentRoles={
                (org as Record<string, unknown> | null)?.[card.field] as string[] ?? card.defaultRoles
              }
              onSave={handlePermissionSave}
              index={index}
              styles={styles}
              neutral={neutral}
            />
          ))}
        </ScrollView>
      </View>

      {/* Select Modals */}
      <SelectModal
        visible={timezoneModalVisible}
        title="Select Timezone"
        options={TIMEZONE_OPTIONS}
        selectedValue={org?.timezone ?? null}
        onSelect={handleTimezoneSelect}
        onClose={() => setTimezoneModalVisible(false)}
      />
      <SelectModal
        visible={languageModalVisible}
        title="Select Language"
        options={LANGUAGE_OPTIONS}
        selectedValue={org?.default_language ?? null}
        onSelect={handleLanguageSelect}
        onClose={() => setLanguageModalVisible(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function useCustomizationStyles() {
  return useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    headerTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600" as const,
      color: APP_CHROME.headerTitle,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 40,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      gap: SPACING.md,
    },
    centered: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
    },
    loadingText: {
      fontSize: 14,
      color: n.muted,
    },
    deniedTitle: {
      fontSize: 18,
      fontWeight: "600" as const,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    deniedText: {
      fontSize: 14,
      color: n.muted,
      textAlign: "center" as const,
    },

    // Cards
    card: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "600" as const,
      color: n.foreground,
    },
    cardSubtitle: {
      fontSize: 14,
      color: n.muted,
      marginTop: -SPACING.sm,
    },

    // Logo
    logoSection: {
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    logoTouchable: {
      position: "relative" as const,
    },
    logoImage: {
      width: 72,
      height: 72,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
    },
    logoPlaceholder: {
      width: 72,
      height: 72,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      backgroundColor: n.dark800,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    logoCameraBadge: {
      position: "absolute" as const,
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      borderCurve: "continuous" as const,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    logoHint: {
      fontSize: 13,
      color: n.muted,
    },

    // Color fields
    colorFieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500" as const,
      color: n.foreground,
    },
    colorInputRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    colorSwatch: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
    },
    colorInput: {
      flex: 1,
      backgroundColor: n.surface,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingVertical: 10,
      paddingHorizontal: 14,
      fontSize: 15,
      color: n.foreground,
    },
    hexDisplay: {
      fontSize: 12,
      color: n.muted,
    },

    // Palette
    paletteSection: {
      gap: SPACING.sm,
    },
    paletteRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 8,
    },
    paletteSwatch: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderCurve: "continuous" as const,
    },

    // Localization
    localizationGap: {
      height: SPACING.sm,
    },
    selectValueDisplay: {
      fontSize: 12,
      color: n.muted,
      marginTop: -SPACING.sm,
    },

    // Switch row
    switchRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
    },
    switchTextContainer: {
      flex: 1,
      marginRight: SPACING.md,
    },
    switchLabel: {
      fontSize: 15,
      fontWeight: "500" as const,
      color: n.foreground,
    },
    switchDescription: {
      fontSize: 13,
      color: n.muted,
      marginTop: 2,
    },

    // Permission cards
    permissionRows: {
      gap: SPACING.xs,
    },
    checkboxRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: 6,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: RADIUS.xs,
      borderWidth: 2,
      borderColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    checkboxChecked: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    checkboxDisabled: {
      opacity: 0.5,
    },
    checkboxLabel: {
      fontSize: 14,
      color: n.foreground,
    },

    // Save button (reused in permission cards)
    saveButton: {
      backgroundColor: s.success,
      paddingVertical: 12,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: n.surface,
    },
  }));
}
