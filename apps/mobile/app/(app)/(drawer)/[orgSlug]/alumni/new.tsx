import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { ChevronLeft } from "lucide-react-native";
import { z } from "@teammeet/validation";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

// Validation schema for alumni form
const alumniFormSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(100),
  last_name: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(320).optional().or(z.literal("")),
  graduation_year: z.string().optional(),
  major: z.string().trim().max(200).optional(),
  job_title: z.string().trim().max(200).optional(),
  position_title: z.string().trim().max(200).optional(),
  current_company: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  current_city: z.string().trim().max(100).optional(),
  phone_number: z.string().trim().max(50).optional(),
  photo_url: z.string().url("Invalid URL").max(500).optional().or(z.literal("")),
  linkedin_url: z.string().url("Invalid LinkedIn URL").max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

type FormData = {
  first_name: string;
  last_name: string;
  email: string;
  graduation_year: string;
  major: string;
  job_title: string;
  position_title: string;
  current_company: string;
  industry: string;
  current_city: string;
  phone_number: string;
  photo_url: string;
  linkedin_url: string;
  notes: string;
};

const INITIAL_FORM_DATA: FormData = {
  first_name: "",
  last_name: "",
  email: "",
  graduation_year: "",
  major: "",
  job_title: "",
  position_title: "",
  current_company: "",
  industry: "",
  current_city: "",
  phone_number: "",
  photo_url: "",
  linkedin_url: "",
  notes: "",
};

export default function NewAlumniScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);

  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_DATA);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available
    }
  }, [navigation]);

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error when user types
    setFieldErrors((prev) => {
      const updated = { ...prev };
      delete updated[field];
      return updated;
    });
  }, []);

  const validateForm = useCallback((): boolean => {
    const result = alumniFormSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      });
      setFieldErrors(errors);
      return false;
    }
    setFieldErrors({});
    return true;
  }, [formData]);

  const handleSubmit = useCallback(async () => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    if (!validateForm()) {
      setError("Please fix the errors below.");
      return;
    }

    // Validate LinkedIn URL format
    const linkedin = formData.linkedin_url.trim();
    if (linkedin) {
      try {
        const url = new URL(linkedin);
        if (url.protocol !== "https:") {
          setError("LinkedIn URL must start with https://");
          return;
        }
      } catch {
        setError("Please enter a valid LinkedIn profile URL.");
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      const graduationYear = formData.graduation_year.trim();
      const parsedYear = graduationYear ? parseInt(graduationYear, 10) : null;

      if (graduationYear && (isNaN(parsedYear!) || parsedYear! < 1900 || parsedYear! > 2100)) {
        setError("Please enter a valid graduation year (1900-2100).");
        setIsSaving(false);
        return;
      }

      const { error: insertError } = await supabase.from("alumni").insert({
        organization_id: orgId,
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim() || null,
        graduation_year: parsedYear,
        major: formData.major.trim() || null,
        job_title: formData.job_title.trim() || null,
        position_title: formData.position_title.trim() || null,
        current_company: formData.current_company.trim() || null,
        industry: formData.industry.trim() || null,
        current_city: formData.current_city.trim() || null,
        phone_number: formData.phone_number.trim() || null,
        photo_url: formData.photo_url.trim() || null,
        linkedin_url: linkedin || null,
        notes: formData.notes.trim() || null,
      });

      if (insertError) {
        throw insertError;
      }

      router.push(`/(app)/${orgSlug}/(tabs)/alumni`);
    } catch (e) {
      setError((e as Error).message || "Failed to create alumni.");
    } finally {
      setIsSaving(false);
    }
  }, [orgId, orgSlug, formData, validateForm, router]);

  // Loading state
  if (roleLoading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Add Alumni</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={[styles.contentSheet, styles.centered]}>
          <ActivityIndicator size="large" color={SEMANTIC.success} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  // Access denied state
  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.back()} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Add Alumni</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={[styles.contentSheet, styles.centered]}>
          <Text style={styles.accessDeniedTitle}>Access Denied</Text>
          <Text style={styles.accessDeniedText}>
            Only administrators can add alumni.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Add Alumni</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.contentSheet}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Add Alumni</Text>
            <Text style={styles.formSubtitle}>Add an alumni to your organization's network</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Name fields */}
          <View style={styles.row}>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>First Name *</Text>
              <TextInput
                value={formData.first_name}
                onChangeText={(v) => updateField("first_name", v)}
                placeholder="John"
                placeholderTextColor={NEUTRAL.placeholder}
                style={[styles.input, fieldErrors.first_name && styles.inputError]}
              />
              {fieldErrors.first_name && (
                <Text style={styles.fieldError}>{fieldErrors.first_name}</Text>
              )}
            </View>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Last Name *</Text>
              <TextInput
                value={formData.last_name}
                onChangeText={(v) => updateField("last_name", v)}
                placeholder="Doe"
                placeholderTextColor={NEUTRAL.placeholder}
                style={[styles.input, fieldErrors.last_name && styles.inputError]}
              />
              {fieldErrors.last_name && (
                <Text style={styles.fieldError}>{fieldErrors.last_name}</Text>
              )}
            </View>
          </View>

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={formData.email}
              onChangeText={(v) => updateField("email", v)}
              placeholder="alumni@example.com"
              placeholderTextColor={NEUTRAL.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
              style={[styles.input, fieldErrors.email && styles.inputError]}
            />
            {fieldErrors.email && (
              <Text style={styles.fieldError}>{fieldErrors.email}</Text>
            )}
          </View>

          {/* Graduation year and major */}
          <View style={styles.row}>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Graduation Year</Text>
              <TextInput
                value={formData.graduation_year}
                onChangeText={(v) => updateField("graduation_year", v)}
                placeholder="2020"
                placeholderTextColor={NEUTRAL.placeholder}
                keyboardType="number-pad"
                maxLength={4}
                style={styles.input}
              />
            </View>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Major</Text>
              <TextInput
                value={formData.major}
                onChangeText={(v) => updateField("major", v)}
                placeholder="e.g., Finance"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
              />
            </View>
          </View>

          {/* Position and company */}
          <View style={styles.row}>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Position Title</Text>
              <TextInput
                value={formData.position_title}
                onChangeText={(v) => updateField("position_title", v)}
                placeholder="e.g., Software Engineer"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
              />
            </View>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Company</Text>
              <TextInput
                value={formData.current_company}
                onChangeText={(v) => updateField("current_company", v)}
                placeholder="e.g., Google"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
              />
            </View>
          </View>

          {/* Industry and city */}
          <View style={styles.row}>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>Industry</Text>
              <TextInput
                value={formData.industry}
                onChangeText={(v) => updateField("industry", v)}
                placeholder="e.g., Technology"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
              />
            </View>
            <View style={[styles.fieldGroup, styles.halfWidth]}>
              <Text style={styles.fieldLabel}>City</Text>
              <TextInput
                value={formData.current_city}
                onChangeText={(v) => updateField("current_city", v)}
                placeholder="e.g., San Francisco"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
              />
            </View>
          </View>

          {/* Phone */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Phone Number</Text>
            <TextInput
              value={formData.phone_number}
              onChangeText={(v) => updateField("phone_number", v)}
              placeholder="+1 (555) 123-4567"
              placeholderTextColor={NEUTRAL.placeholder}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>

          {/* Photo URL */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Photo URL</Text>
            <TextInput
              value={formData.photo_url}
              onChangeText={(v) => updateField("photo_url", v)}
              placeholder="https://example.com/photo.jpg"
              placeholderTextColor={NEUTRAL.placeholder}
              autoCapitalize="none"
              keyboardType="url"
              style={[styles.input, fieldErrors.photo_url && styles.inputError]}
            />
            <Text style={styles.helperText}>Direct link to alumni photo</Text>
            {fieldErrors.photo_url && (
              <Text style={styles.fieldError}>{fieldErrors.photo_url}</Text>
            )}
          </View>

          {/* LinkedIn */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LinkedIn Profile</Text>
            <TextInput
              value={formData.linkedin_url}
              onChangeText={(v) => updateField("linkedin_url", v)}
              placeholder="https://linkedin.com/in/username"
              placeholderTextColor={NEUTRAL.placeholder}
              autoCapitalize="none"
              keyboardType="url"
              style={[styles.input, fieldErrors.linkedin_url && styles.inputError]}
            />
            <Text style={styles.helperText}>Must be a valid https:// URL</Text>
            {fieldErrors.linkedin_url && (
              <Text style={styles.fieldError}>{fieldErrors.linkedin_url}</Text>
            )}
          </View>

          {/* Legacy job title */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Current Position (Legacy)</Text>
            <TextInput
              value={formData.job_title}
              onChangeText={(v) => updateField("job_title", v)}
              placeholder="e.g., Software Engineer at Google"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
            <Text style={styles.helperText}>
              Optional - use Position Title and Company above for better filtering
            </Text>
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              value={formData.notes}
              onChangeText={(v) => updateField("notes", v)}
              placeholder="Any additional notes about this alumni..."
              placeholderTextColor={NEUTRAL.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          {/* Action buttons */}
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && { opacity: 0.9 },
                isSaving && styles.buttonDisabled,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Add Alumni</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    headerContent: {
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
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
      marginTop: SPACING.md,
    },
    accessDeniedTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    accessDeniedText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
      textAlign: "center",
      marginBottom: SPACING.lg,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    formHeader: {
      gap: SPACING.xs,
    },
    formTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
    },
    formSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
    },
    errorCard: {
      backgroundColor: SEMANTIC.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: SEMANTIC.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: SEMANTIC.error,
    },
    row: {
      flexDirection: "row",
      gap: SPACING.md,
    },
    halfWidth: {
      flex: 1,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      backgroundColor: NEUTRAL.surface,
    },
    inputError: {
      borderColor: SEMANTIC.error,
    },
    textArea: {
      minHeight: 100,
    },
    helperText: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
    },
    fieldError: {
      ...TYPOGRAPHY.caption,
      color: SEMANTIC.error,
    },
    buttonRow: {
      flexDirection: "row",
      gap: SPACING.md,
      marginTop: SPACING.md,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: NEUTRAL.border,
    },
    secondaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.foreground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
}
