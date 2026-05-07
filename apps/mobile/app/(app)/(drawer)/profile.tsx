import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { ChevronLeft, Camera, Trash2 } from "lucide-react-native";
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
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    orgSelectorList: {
      gap: SPACING.sm,
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
    orgOptionSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    orgOptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    orgOptionTextSelected: {
      color: s.successDark,
    },
    contextCard: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      gap: SPACING.xs,
    },
    contextLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
      textTransform: "uppercase" as const,
      letterSpacing: 0.4,
    },
    contextValue: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
    },
    rolePill: {
      alignSelf: "flex-start" as const,
      backgroundColor: s.successLight,
      borderRadius: 999,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
    },
    rolePillText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.successDark,
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
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    deleteAccountRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.md,
      marginTop: SPACING.sm,
    },
    deleteAccountLabel: {
      ...TYPOGRAPHY.labelLarge,
      color: s.error,
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
        setFormValues(buildProfileFormValues(nextRole, row, currentUser));
      } catch (loadError) {
        if (!isMounted) return;
        setProfileRole(null);
        setProfileRecordId(null);
        setProfileAvatarUrl(null);
        setFormValues(INITIAL_PROFILE_FORM_VALUES);
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
    router.back();
  }, [router]);

  const handleFieldChange = useCallback(
    <K extends keyof ProfileFormValues>(field: K, value: ProfileFormValues[K]) => {
      setFormValues((current) => ({
        ...current,
        [field]: value,
      }));
    },
    []
  );

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
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={formValues[field]}
        onChangeText={(text) => handleFieldChange(field, text)}
        placeholder={options?.placeholder}
        placeholderTextColor={neutral.placeholder}
        style={[
          styles.input,
          options?.multiline ? styles.textArea : null,
        ] as any}
        multiline={options?.multiline}
        keyboardType={options?.keyboardType}
        autoCapitalize={options?.autoCapitalize ?? "words"}
        autoCorrect={false}
        maxLength={options?.maxLength}
      />
      {options?.helperText ? <Text style={styles.fieldHint}>{options.helperText}</Text> : null}
    </View>
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        >
          {hasMultipleOrganizations ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Organization</Text>
              <Text style={styles.sectionBody}>
                Your profile edits apply to one organization at a time.
              </Text>
              <View style={styles.orgSelectorList}>
                {organizations.map((organization) => {
                  const isSelected = organization.slug === resolvedOrganization?.slug;
                  return (
                    <Pressable
                      key={organization.id}
                      onPress={() => setSelectedOrgSlug(organization.slug)}
                      style={[
                        styles.orgOption,
                        isSelected ? styles.orgOptionSelected : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.orgOptionText,
                          isSelected ? styles.orgOptionTextSelected : null,
                        ]}
                      >
                        {organization.name || organization.slug}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

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
            </View>
          ) : null}

          {resolvedOrganization ? (
            <View style={styles.contextCard}>
              <Text style={styles.contextLabel}>Active organization</Text>
              <Text style={styles.contextValue}>
                {resolvedOrganization.name || resolvedOrganization.slug}
              </Text>
              {profileRole ? (
                <View style={styles.rolePill}>
                  <Text style={styles.rolePillText}>{getEditableProfileRoleLabel(profileRole)}</Text>
                </View>
              ) : null}
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

              <Pressable
                onPress={handleSave}
                disabled={isSaving || isUploading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                  (isSaving || isUploading) && styles.buttonDisabled,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Save Changes</Text>
                )}
              </Pressable>

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
                  styles.deleteAccountRow,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Trash2 size={18} color={semantic.error} />
                <Text style={styles.deleteAccountLabel}>Delete My Account</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
