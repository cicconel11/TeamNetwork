import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  ShieldOff,
  Trash2,
  Wallet,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { Database, Organization } from "@teammeet/types";
import { useAuth } from "@/hooks/useAuth";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { useOrganizations } from "@/hooks/useOrganizations";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { LinkedInSyncCard } from "@/components/profile/LinkedInSyncCard";
import {
  INITIAL_PROFILE_FORM_VALUES,
  buildAlumniProfileUpdate,
  buildAuthMetadataUpdate,
  buildMemberProfileUpdate,
  buildParentProfileUpdate,
  buildProfileFormValues,
  getEditableProfileRoleLabel,
  resolveProfileOrganization,
  toEditableProfileRole,
  validateProfileForm,
  type EditableProfileRole,
  type ProfileFormValues,
} from "@/lib/profile";

type MemberRow = Database["public"]["Tables"]["members"]["Row"];
type AlumniRow = Database["public"]["Tables"]["alumni"]["Row"];
type ParentRow = Database["public"]["Tables"]["parents"]["Row"];
type EditableProfileRow = MemberRow | AlumniRow | ParentRow;

function getParamValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function getRowPhotoUrl(row: EditableProfileRow): string | null {
  return row.photo_url ?? null;
}

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  placeholderTextColor: string;
  helperText?: string;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words";
  maxLength?: number;
  inputStyle: any;
  textAreaStyle: any;
  labelStyle: any;
  hintStyle: any;
  groupStyle: any;
}

const FormField = memo(function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  helperText,
  multiline,
  keyboardType,
  autoCapitalize,
  maxLength,
  inputStyle,
  textAreaStyle,
  labelStyle,
  hintStyle,
  groupStyle,
}: FormFieldProps) {
  return (
    <View style={groupStyle}>
      <Text style={labelStyle}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        style={[inputStyle, multiline ? textAreaStyle : null]}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? "words"}
        autoCorrect={false}
        maxLength={maxLength}
      />
      {helperText ? <Text style={hintStyle}>{helperText}</Text> : null}
    </View>
  );
});

export default function ProfileScreen() {
  const router = useRouter();
  const { currentSlug } = useLocalSearchParams<{ currentSlug?: string | string[] }>();
  const routeSlug = getParamValue(currentSlug);
  const { user, isLoading: authLoading } = useAuth();
  const { organizations, loading: organizationsLoading } = useOrganizations();
  const { neutral, semantic } = useAppColorScheme();
  const [selectedOrgSlug, setSelectedOrgSlug] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<EditableProfileRole | null>(null);
  const [profileRecordId, setProfileRecordId] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ProfileFormValues>(INITIAL_PROFILE_FORM_VALUES);
  const [initialFormValues, setInitialFormValues] = useState<ProfileFormValues>(INITIAL_PROFILE_FORM_VALUES);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (localAvatarUrl) return true;
    return (Object.keys(formValues) as Array<keyof ProfileFormValues>).some(
      (key) => formValues[key] !== initialFormValues[key]
    );
  }, [formValues, initialFormValues, localAvatarUrl]);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {},
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 36,
    },
    headerSaveButton: {
      minWidth: 56,
      height: 36,
      alignItems: "flex-end" as const,
      justifyContent: "center" as const,
    },
    headerSaveText: {
      ...TYPOGRAPHY.labelLarge,
      color: APP_CHROME.headerTitle,
      fontWeight: "600" as const,
    },
    headerSaveTextDisabled: {
      opacity: 0.4,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      gap: SPACING.sm,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    sectionCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    sectionBody: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    orgOption: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.background,
    },
    orgOptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    avatarSection: {
      alignItems: "center" as const,
      paddingVertical: SPACING.lg,
    },
    avatarWrapper: {
      position: "relative" as const,
      width: 120,
      height: 120,
      boxShadow: "0px 4px 16px rgba(0, 0, 0, 0.12)",
      borderRadius: 60,
    },
    avatar: {
      width: 120,
      height: 120,
      borderRadius: 60,
    },
    avatarPlaceholder: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: s.successLight,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarPlaceholderText: {
      fontSize: 48,
      fontWeight: "600" as const,
      color: s.successDark,
    },
    cameraOverlay: {
      position: "absolute" as const,
      bottom: 0,
      right: 0,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: s.info,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 2,
      borderColor: n.surface,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    fieldHint: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    textArea: {
      minHeight: 96,
      textAlignVertical: "top" as const,
    },
    readOnlyField: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.background,
    },
    readOnlyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
    },
    row: {
      flexDirection: "row" as const,
      gap: SPACING.md,
    },
    halfWidth: {
      flex: 1,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    orgChip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      alignSelf: "center" as const,
      gap: 6,
      marginTop: SPACING.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      maxWidth: "90%" as const,
    },
    orgChipLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      flexShrink: 1,
    },
    orgChipRole: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    groupedListWrap: {
      gap: SPACING.xs,
    },
    groupedListHeader: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
      paddingHorizontal: SPACING.md,
    },
    groupedList: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      overflow: "hidden" as const,
    },
    groupedRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.md,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
      minHeight: 48,
    },
    groupedRowPressed: {
      backgroundColor: n.background,
    },
    groupedRowLabel: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
      flex: 1,
    },
    groupedDivider: {
      height: 1,
      marginLeft: SPACING.md + 20 + SPACING.md,
      backgroundColor: n.border,
    },
  }));

  const resolvedOrganization = useMemo(
    () =>
      resolveProfileOrganization(
        organizations as Organization[],
        selectedOrgSlug ?? routeSlug,
        null
      ),
    [organizations, routeSlug, selectedOrgSlug]
  );

  const hasMultipleOrganizations = organizations.length > 1;
  const awaitingOrganizationSelection =
    !resolvedOrganization && !organizationsLoading && hasMultipleOrganizations;

  const { isUploading, error: uploadError, pickAndUpload } = useAvatarUpload(user?.id);
  const isLoading = authLoading || organizationsLoading || loadingProfile;
  const avatarUrl =
    localAvatarUrl ??
    profileAvatarUrl ??
    ((user?.user_metadata as { avatar_url?: string } | undefined)?.avatar_url ?? null);
  const initial =
    (formValues.first_name ||
      formValues.last_name ||
      ((user?.user_metadata as { name?: string } | undefined)?.name ?? "") ||
      user?.email ||
      "U")
      .trim()
      .charAt(0)
      .toUpperCase() || "U";

  useEffect(() => {
    if (uploadError) {
      setError(uploadError);
    }
  }, [uploadError]);

  useEffect(() => {
    if (!user || !resolvedOrganization) {
      setProfileRole(null);
      setProfileRecordId(null);
      setProfileAvatarUrl(null);
      setFormValues(INITIAL_PROFILE_FORM_VALUES);
      setInitialFormValues(INITIAL_PROFILE_FORM_VALUES);
      setLoadingProfile(false);
      return;
    }

    let isMounted = true;
    const currentUser = user;
    const currentOrganization = resolvedOrganization;

    async function loadProfile() {
      setLoadingProfile(true);
      setError(null);

      try {
        const { data: membership, error: membershipError } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("organization_id", currentOrganization.id)
          .eq("user_id", currentUser.id)
          .eq("status", "active")
          .maybeSingle();

        if (membershipError) {
          throw membershipError;
        }

        const nextRole = toEditableProfileRole(membership?.role);
        if (!nextRole) {
          throw new Error("This organization role does not support mobile profile editing yet.");
        }

        let row: EditableProfileRow | null = null;

        if (nextRole === "member") {
          const { data, error: rowError } = await supabase
            .from("members")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("user_id", currentUser.id)
            .is("deleted_at", null)
            .maybeSingle();

          if (rowError) throw rowError;
          row = data;
        } else if (nextRole === "alumni") {
          const { data, error: rowError } = await supabase
            .from("alumni")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("user_id", currentUser.id)
            .is("deleted_at", null)
            .maybeSingle();

          if (rowError) throw rowError;
          row = data;
        } else {
          const { data, error: rowError } = await supabase
            .from("parents")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .eq("user_id", currentUser.id)
            .is("deleted_at", null)
            .maybeSingle();

          if (rowError) throw rowError;
          row = data;
        }

        if (!row) {
          throw new Error("No editable profile was found for this organization.");
        }

        if (!isMounted) return;

        setProfileRole(nextRole);
        setProfileRecordId(row.id);
        setProfileAvatarUrl(getRowPhotoUrl(row));
        const nextValues = buildProfileFormValues(nextRole, row, currentUser);
        setFormValues(nextValues);
        setInitialFormValues(nextValues);
        setLocalAvatarUrl(null);
      } catch (loadError) {
        if (!isMounted) return;
        setProfileRole(null);
        setProfileRecordId(null);
        setProfileAvatarUrl(null);
        setFormValues(INITIAL_PROFILE_FORM_VALUES);
        setInitialFormValues(INITIAL_PROFILE_FORM_VALUES);
        setError((loadError as Error).message || "Failed to load profile");
      } finally {
        if (isMounted) {
          setLoadingProfile(false);
        }
      }
    }

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [resolvedOrganization, user]);

  const handleBack = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to leave?",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => router.back(),
          },
        ],
      );
      return;
    }
    router.back();
  }, [isDirty, router]);

  const handleOrgPress = useCallback(() => {
    if (organizations.length <= 1) return;
    const orgList = organizations as Organization[];
    const labels = orgList.map((o) => o.name || o.slug);
    const activeIndex = orgList.findIndex(
      (o) => o.slug === resolvedOrganization?.slug,
    );
    const onPick = (idx: number) => {
      const next = orgList[idx];
      if (!next || next.slug === resolvedOrganization?.slug) return;
      setSelectedOrgSlug(next.slug);
      if (Platform.OS === "ios") {
        void Haptics.selectionAsync();
      }
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          title: "Switch organization",
          userInterfaceStyle: "light",
        },
        (idx) => {
          if (idx === labels.length) return;
          onPick(idx);
        },
      );
      return;
    }
    Alert.alert(
      "Switch organization",
      undefined,
      [
        ...orgList.map((o, idx) => ({
          text: `${o.name || o.slug}${idx === activeIndex ? "  ✓" : ""}`,
          onPress: () => onPick(idx),
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  }, [organizations, resolvedOrganization]);

  const handleFieldChange = useCallback(
    <K extends keyof ProfileFormValues>(field: K, value: ProfileFormValues[K]) => {
      setFormValues((current) => ({
        ...current,
        [field]: value,
      }));
    },
    []
  );

  const fieldHandlers = useMemo(() => {
    const handlers = {} as Record<keyof ProfileFormValues, (text: string) => void>;
    (Object.keys(INITIAL_PROFILE_FORM_VALUES) as Array<keyof ProfileFormValues>).forEach(
      (key) => {
        handlers[key] = (text: string) => handleFieldChange(key, text);
      },
    );
    return handlers;
  }, [handleFieldChange]);

  const handleAvatarPress = useCallback(async () => {
    const newUrl = await pickAndUpload();
    if (newUrl) {
      setLocalAvatarUrl(newUrl);
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [pickAndUpload]);

  const handleSave = useCallback(async () => {
    if (!user || !resolvedOrganization || !profileRole || !profileRecordId) {
      setError("Profile context is not ready yet.");
      return;
    }

    const currentUser = user;
    const currentOrganization = resolvedOrganization;

    setError(null);

    const validationResult = validateProfileForm(profileRole, formValues);
    if (!validationResult.success) {
      setError(validationResult.error.issues[0]?.message ?? "Invalid profile data");
      return;
    }

    const nextAvatarUrl = avatarUrl;
    setIsSaving(true);

    try {
      if (profileRole === "member") {
        const { error: updateError } = await supabase
          .from("members")
          .update(buildMemberProfileUpdate(validationResult.data, nextAvatarUrl))
          .eq("id", profileRecordId)
          .eq("organization_id", currentOrganization.id);

        if (updateError) throw updateError;
      } else if (profileRole === "alumni") {
        const { error: updateError } = await supabase
          .from("alumni")
          .update(buildAlumniProfileUpdate(validationResult.data, nextAvatarUrl))
          .eq("id", profileRecordId)
          .eq("organization_id", currentOrganization.id);

        if (updateError) throw updateError;
      } else {
        const { error: updateError } = await supabase
          .from("parents")
          .update(buildParentProfileUpdate(validationResult.data, nextAvatarUrl))
          .eq("id", profileRecordId)
          .eq("organization_id", currentOrganization.id);

        if (updateError) throw updateError;
      }

      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: buildAuthMetadataUpdate(
          validationResult.data,
          nextAvatarUrl ?? undefined
        ),
      });

      if (authUpdateError) {
        throw authUpdateError;
      }

      setProfileAvatarUrl(nextAvatarUrl);
      setLocalAvatarUrl(null);

      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      router.back();
    } catch (saveError) {
      setError((saveError as Error).message || "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  }, [avatarUrl, formValues, profileRecordId, profileRole, resolvedOrganization, router, user]);

  const renderInput = (
    field: keyof ProfileFormValues,
    label: string,
    options?: {
      placeholder?: string;
      multiline?: boolean;
      helperText?: string;
      keyboardType?: "default" | "number-pad" | "email-address";
      autoCapitalize?: "none" | "sentences" | "words";
      maxLength?: number;
    }
  ) => (
    <FormField
      label={label}
      value={formValues[field]}
      onChangeText={fieldHandlers[field]}
      placeholder={options?.placeholder}
      placeholderTextColor={neutral.placeholder}
      helperText={options?.helperText}
      multiline={options?.multiline}
      keyboardType={options?.keyboardType}
      autoCapitalize={options?.autoCapitalize}
      maxLength={options?.maxLength}
      inputStyle={styles.input}
      textAreaStyle={styles.textArea}
      labelStyle={styles.fieldLabel}
      hintStyle={styles.fieldHint}
      groupStyle={styles.fieldGroup}
    />
  );

  const renderRoleFields = () => {
    if (!profileRole) return null;

    if (profileRole === "member") {
      return (
        <Animated.View entering={FadeInDown.duration(250).delay(80)} style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Member Details</Text>
          <View style={styles.row}>
            <View style={styles.halfWidth}>
              {renderInput("graduation_year", "Graduation Year", {
                placeholder: "e.g. 2027",
                keyboardType: "number-pad",
                autoCapitalize: "none",
                maxLength: 4,
              })}
            </View>
            <View style={styles.halfWidth}>
              {renderInput("expected_graduation_date", "Expected Graduation Date", {
                placeholder: "YYYY-MM-DD",
                autoCapitalize: "none",
              })}
            </View>
          </View>
          {renderInput("linkedin_url", "LinkedIn Profile", {
            placeholder: "https://www.linkedin.com/in/username",
            autoCapitalize: "none",
          })}
        </Animated.View>
      );
    }

    if (profileRole === "alumni") {
      return (
        <Animated.View entering={FadeInDown.duration(250).delay(80)} style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Alumni Details</Text>
          <View style={styles.row}>
            <View style={styles.halfWidth}>
              {renderInput("graduation_year", "Graduation Year", {
                placeholder: "e.g. 2020",
                keyboardType: "number-pad",
                autoCapitalize: "none",
                maxLength: 4,
              })}
            </View>
            <View style={styles.halfWidth}>
              {renderInput("major", "Major", {
                placeholder: "e.g. Computer Science",
              })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.halfWidth}>
              {renderInput("position_title", "Position Title", {
                placeholder: "e.g. Software Engineer",
              })}
            </View>
            <View style={styles.halfWidth}>
              {renderInput("current_company", "Current Company", {
                placeholder: "e.g. Google",
              })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.halfWidth}>
              {renderInput("job_title", "Current Position (Legacy)", {
                placeholder: "e.g. Senior Product Manager",
              })}
            </View>
            <View style={styles.halfWidth}>
              {renderInput("industry", "Industry", {
                placeholder: "e.g. Technology",
              })}
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.halfWidth}>
              {renderInput("current_city", "Current City", {
                placeholder: "e.g. New York, NY",
              })}
            </View>
            <View style={styles.halfWidth}>
              {renderInput("phone_number", "Phone Number", {
                placeholder: "e.g. +1 (555) 123-4567",
                autoCapitalize: "none",
              })}
            </View>
          </View>
          {renderInput("linkedin_url", "LinkedIn Profile", {
            placeholder: "https://www.linkedin.com/in/username",
            autoCapitalize: "none",
          })}
          {renderInput("notes", "Notes", {
            placeholder: "Add anything you want your organization to know",
            multiline: true,
            autoCapitalize: "sentences",
          })}
        </Animated.View>
      );
    }

    return (
      <Animated.View entering={FadeInDown.duration(250).delay(80)} style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Parent Details</Text>
        <View style={styles.row}>
          <View style={styles.halfWidth}>
            {renderInput("student_name", "Student Name", {
              placeholder: "e.g. Alex Smith",
            })}
          </View>
          <View style={styles.halfWidth}>
            {renderInput("relationship", "Relationship", {
              placeholder: "e.g. Guardian",
            })}
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.halfWidth}>
            {renderInput("phone_number", "Phone Number", {
              placeholder: "e.g. +1 (555) 123-4567",
              autoCapitalize: "none",
            })}
          </View>
          <View style={styles.halfWidth}>
            {renderInput("linkedin_url", "LinkedIn Profile", {
              placeholder: "https://www.linkedin.com/in/username",
              autoCapitalize: "none",
            })}
          </View>
        </View>
        {renderInput("notes", "Notes", {
          placeholder: "Any additional notes",
          multiline: true,
          autoCapitalize: "sentences",
        })}
      </Animated.View>
    );
  };

  if (isLoading && resolvedOrganization) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]} style={styles.headerGradient}>
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Edit Profile</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={APP_CHROME.headerTitle} />
            <Text style={styles.loadingText}>Loading your profile…</Text>
          </View>
        </View>
      </View>
    );
  }

  const saveDisabled = isSaving || isUploading || !isDirty;
  const activeOrgLabel = resolvedOrganization
    ? resolvedOrganization.name || resolvedOrganization.slug
    : null;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]} style={styles.headerGradient}>
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleBack}
              style={styles.backButton}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Edit Profile</Text>
            <Pressable
              onPress={handleSave}
              disabled={saveDisabled}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Save"
              style={({ pressed }) => [
                styles.headerSaveButton,
                pressed && !saveDisabled && { opacity: 0.6 },
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color={APP_CHROME.headerTitle} size="small" />
              ) : (
                <Text
                  style={[
                    styles.headerSaveText,
                    saveDisabled && styles.headerSaveTextDisabled,
                  ]}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.contentSheet}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        >
          {!user ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>You must be signed in to edit your profile.</Text>
            </View>
          ) : null}

          {awaitingOrganizationSelection ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Choose an organization</Text>
              <Text style={styles.sectionBody}>
                Select which organization profile you want to edit.
              </Text>
              {organizations.map((organization) => (
                <Pressable
                  key={organization.id}
                  onPress={() => setSelectedOrgSlug(organization.slug)}
                  style={({ pressed }) => [
                    styles.orgOption,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.orgOptionText}>
                    {organization.name || organization.slug}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {resolvedOrganization && profileRole ? (
            <>
              <View style={styles.avatarSection}>
                <Pressable
                  onPress={handleAvatarPress}
                  disabled={isUploading}
                  accessibilityRole="button"
                  accessibilityLabel="Change photo"
                  style={styles.avatarWrapper as any}
                >
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarPlaceholderText}>{initial}</Text>
                    </View>
                  )}
                  <View style={styles.cameraOverlay}>
                    {isUploading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Camera size={16} color="#ffffff" />
                    )}
                  </View>
                </Pressable>
                {activeOrgLabel ? (
                  <Pressable
                    onPress={handleOrgPress}
                    disabled={organizations.length <= 1}
                    accessibilityRole="button"
                    accessibilityLabel={`Active organization: ${activeOrgLabel}. ${
                      organizations.length > 1 ? "Tap to switch." : ""
                    }`}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.orgChip,
                      pressed && organizations.length > 1 && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.orgChipLabel} numberOfLines={1}>
                      {activeOrgLabel}
                    </Text>
                    {profileRole ? (
                      <Text style={styles.orgChipRole}>
                        · {getEditableProfileRoleLabel(profileRole)}
                      </Text>
                    ) : null}
                    {organizations.length > 1 ? (
                      <ChevronDown size={14} color={neutral.secondary} />
                    ) : null}
                  </Pressable>
                ) : null}
              </View>

              <Animated.View entering={FadeInDown.duration(250)} style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Basic Information</Text>
                <View style={styles.row}>
                  <View style={styles.halfWidth}>
                    {renderInput("first_name", "First Name", {
                      placeholder: "Your first name",
                    })}
                  </View>
                  <View style={styles.halfWidth}>
                    {renderInput("last_name", "Last Name", {
                      placeholder: "Your last name",
                    })}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <View style={styles.readOnlyField as any}>
                    <Text selectable style={styles.readOnlyText}>
                      {formValues.email || user?.email || ""}
                    </Text>
                  </View>
                  <Text style={styles.fieldHint}>Email is managed from your account and cannot be changed here.</Text>
                </View>
              </Animated.View>

              {renderRoleFields()}

              <LinkedInSyncCard />

              <View style={styles.groupedListWrap}>
                <Text style={styles.groupedListHeader}>Account</Text>
                <View style={styles.groupedList}>
                  {Platform.OS === "ios" && routeSlug ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add member card to Apple Wallet"
                        onPress={() => {
                          router.push(
                            `/(app)/(drawer)/${routeSlug}/wallet/add-member-card` as any,
                          );
                        }}
                        style={({ pressed }) => [
                          styles.groupedRow,
                          pressed && styles.groupedRowPressed,
                        ]}
                      >
                        <Wallet size={20} color={neutral.foreground} />
                        <Text style={styles.groupedRowLabel}>Add to Apple Wallet</Text>
                        <ChevronRight size={18} color={neutral.placeholder} />
                      </Pressable>
                      <View style={styles.groupedDivider} />
                    </>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Terms of Service"
                    onPress={() => {
                      router.push({
                        pathname: "/(app)/(drawer)/terms",
                        params: routeSlug ? { currentSlug: routeSlug } : undefined,
                      } as any);
                    }}
                    style={({ pressed }) => [
                      styles.groupedRow,
                      pressed && styles.groupedRowPressed,
                    ]}
                  >
                    <FileText size={20} color={neutral.foreground} />
                    <Text style={styles.groupedRowLabel}>Terms of Service</Text>
                    <ChevronRight size={18} color={neutral.placeholder} />
                  </Pressable>
                  <View style={styles.groupedDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Blocked Users"
                    onPress={() => {
                      router.push({
                        pathname: "/(app)/(drawer)/blocked-users",
                        params: routeSlug ? { currentSlug: routeSlug } : undefined,
                      } as any);
                    }}
                    style={({ pressed }) => [
                      styles.groupedRow,
                      pressed && styles.groupedRowPressed,
                    ]}
                  >
                    <ShieldOff size={20} color={neutral.foreground} />
                    <Text style={styles.groupedRowLabel}>Blocked Users</Text>
                    <ChevronRight size={18} color={neutral.placeholder} />
                  </Pressable>
                  <View style={styles.groupedDivider} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete My Account"
                    onPress={() => {
                      router.push({
                        pathname: "/(app)/(drawer)/delete-account",
                        params: routeSlug ? { currentSlug: routeSlug } : undefined,
                      } as any);
                    }}
                    style={({ pressed }) => [
                      styles.groupedRow,
                      pressed && styles.groupedRowPressed,
                    ]}
                  >
                    <Trash2 size={20} color={semantic.error} />
                    <Text style={[styles.groupedRowLabel, { color: semantic.error }]}>
                      Delete My Account
                    </Text>
                    <ChevronRight size={18} color={neutral.placeholder} />
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
