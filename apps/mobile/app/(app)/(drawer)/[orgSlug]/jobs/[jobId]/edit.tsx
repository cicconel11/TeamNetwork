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
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useOrg } from "@/contexts/OrgContext";
import { useJobs } from "@/hooks/useJobs";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatDatePickerLabel } from "@/lib/date-format";
import type { LocationType, ExperienceLevel } from "@/types/jobs";

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
];

const EXPERIENCE_LEVEL_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry Level" },
  { value: "mid", label: "Mid Level" },
  { value: "senior", label: "Senior" },
  { value: "executive", label: "Executive" },
];

export default function EditJobScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { orgId } = useOrg();
  const { jobs, updateJob } = useJobs(orgId);

  const job = useMemo(() => jobs.find((j) => j.id === jobId), [jobs, jobId]);

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [description, setDescription] = useState("");
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(null);
  const [location, setLocation] = useState("");
  const [applicationUrl, setApplicationUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const { neutral, semantic } = useAppColorScheme();
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
    cancelButton: {
      paddingVertical: SPACING.xs,
      paddingRight: SPACING.sm,
    },
    cancelButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: APP_CHROME.headerTitle,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 56,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
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
      color: n.foreground,
    },
    formSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
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
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    required: {
      color: s.error,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    textArea: {
      minHeight: 120,
    },
    chipRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    chipTextSelected: {
      color: s.successDark,
      fontWeight: "600" as const,
    },
    datePickerButton: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.surface,
      justifyContent: "center" as const,
    },
    datePickerText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    datePickerPlaceholder: {
      color: n.placeholder,
    },
    clearDateButton: {
      alignSelf: "flex-start" as const,
    },
    clearDateText: {
      ...TYPOGRAPHY.labelSmall,
      color: s.error,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      overflow: "hidden" as const,
      backgroundColor: n.surface,
    },
    pickerDoneButton: {
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    pickerDoneText: {
      ...TYPOGRAPHY.labelLarge,
      color: s.success,
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
  }));

  // Pre-fill form once job is available
  useEffect(() => {
    if (job != null && !initialized) {
      setTitle(job.title ?? "");
      setCompany(job.company ?? "");
      setDescription(job.description ?? "");
      setLocationType((job.location_type as LocationType | null) ?? null);
      setExperienceLevel((job.experience_level as ExperienceLevel | null) ?? null);
      setLocation(job.location ?? "");
      setApplicationUrl(job.application_url ?? "");
      setContactEmail(job.contact_email ?? "");
      setExpiresAt(job.expires_at != null ? new Date(job.expires_at) : null);
      setInitialized(true);
    }
  }, [job, initialized]);

  const handleDateChange = useCallback((_event: unknown, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setExpiresAt(selectedDate);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!jobId) {
      setError("Job ID not found.");
      return;
    }

    if (!title.trim()) {
      setError("Job title is required.");
      return;
    }

    if (!company.trim()) {
      setError("Company name is required.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await updateJob(jobId, {
        title: title.trim(),
        company: company.trim(),
        description: description.trim(),
        location_type: locationType,
        experience_level: experienceLevel,
        location: location.trim() || null,
        application_url: applicationUrl.trim() || null,
        contact_email: contactEmail.trim() || null,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message || "Failed to update job posting.");
    } finally {
      setIsSaving(false);
    }
  }, [
    jobId,
    title,
    company,
    description,
    locationType,
    experienceLevel,
    location,
    applicationUrl,
    contactEmail,
    expiresAt,
    updateJob,
    router,
  ]);

  if (job == null) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={() => router.back()} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Text style={styles.headerTitle}>Edit Job</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.centered}>
          <ActivityIndicator color={semantic.success} />
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
            <Pressable onPress={() => router.back()} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Edit Job</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Edit Job Posting</Text>
            <Text style={styles.formSubtitle}>Update the details for this opportunity</Text>
          </View>

          {error != null && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              Job title <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Software Engineer"
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              Company <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              value={company}
              onChangeText={setCompany}
              placeholder="e.g. Acme Corp"
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the role, responsibilities, and requirements..."
              placeholderTextColor={neutral.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Work type</Text>
            <View style={styles.chipRow}>
              {LOCATION_TYPE_OPTIONS.map((option) => {
                const selected = locationType === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setLocationType(selected ? null : option.value)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Experience level</Text>
            <View style={styles.chipRow}>
              {EXPERIENCE_LEVEL_OPTIONS.map((option) => {
                const selected = experienceLevel === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setExperienceLevel(selected ? null : option.value)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Location</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. San Francisco, CA"
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Application URL</Text>
            <TextInput
              value={applicationUrl}
              onChangeText={setApplicationUrl}
              placeholder="https://example.com/apply"
              placeholderTextColor={neutral.placeholder}
              keyboardType="url"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Contact email</Text>
            <TextInput
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="hiring@example.com"
              placeholderTextColor={neutral.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Expires on (optional)</Text>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={styles.datePickerButton}
            >
              <Text
                style={[
                  styles.datePickerText,
                  expiresAt == null && styles.datePickerPlaceholder,
                ]}
              >
                {formatDatePickerLabel(expiresAt, "Select expiry date")}
              </Text>
            </Pressable>
            {expiresAt != null && (
              <Pressable onPress={() => setExpiresAt(null)} style={styles.clearDateButton}>
                <Text style={styles.clearDateText}>Clear date</Text>
              </Pressable>
            )}
          </View>

          {showDatePicker && (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={expiresAt ?? new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={new Date()}
                onChange={handleDateChange}
              />
              {Platform.OS === "ios" && (
                <Pressable
                  onPress={() => setShowDatePicker(false)}
                  style={styles.pickerDoneButton}
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isSaving && styles.buttonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

