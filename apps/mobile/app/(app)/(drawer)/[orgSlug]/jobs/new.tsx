import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useOrg } from "@/contexts/OrgContext";
import { useJobs } from "@/hooks/useJobs";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatDatePickerLabel } from "@/lib/date-format";
import { isValidEmailAddress, isValidHttpsUrl } from "@/lib/url-safety";
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

export default function NewJobScreen() {
  const router = useRouter();
  const { orgId } = useOrg();
  const { createJob } = useJobs(orgId, undefined, { realtime: false });

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

  const { neutral } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    sheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      minHeight: 48,
      backgroundColor: n.surface,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    cancelButton: {
      paddingVertical: SPACING.xs,
      paddingRight: SPACING.sm,
    },
    cancelButtonText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
      textAlign: "center" as const,
      fontWeight: "600" as const,
    },
    headerSpacer: {
      width: 56,
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

  const handleDateChange = useCallback((_event: unknown, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setExpiresAt(selectedDate);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!orgId) {
      setError("Organization not loaded.");
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

    const trimmedApplicationUrl = applicationUrl.trim();
    if (trimmedApplicationUrl && !isValidHttpsUrl(trimmedApplicationUrl)) {
      setError("Application URL must start with https://");
      return;
    }

    const trimmedContactEmail = contactEmail.trim();
    if (trimmedContactEmail && !isValidEmailAddress(trimmedContactEmail)) {
      setError("Please enter a valid contact email.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await createJob({
        title: title.trim(),
        company: company.trim(),
        description: description.trim(),
        location_type: locationType,
        experience_level: experienceLevel,
        location: location.trim() || null,
        application_url: trimmedApplicationUrl || null,
        contact_email: trimmedContactEmail.toLowerCase() || null,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message || "Failed to create job posting.");
    } finally {
      setIsSaving(false);
    }
  }, [
    orgId,
    title,
    company,
    description,
    locationType,
    experienceLevel,
    location,
    applicationUrl,
    contactEmail,
    expiresAt,
    createJob,
    router,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.sheetHeader}>
        <Pressable onPress={() => router.back()} style={styles.cancelButton}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Post a Job</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

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
              <Text style={styles.primaryButtonText}>Post Job</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}
