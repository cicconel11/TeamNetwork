import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { saveMentorProfile } from "@/lib/mentorship-api";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import type {
  MentorProfilePayload,
  MentorProfileRecord,
  MentorProfileSuggestedDefaults,
} from "@/types/mentorship";

const MEETING_OPTIONS: Array<"video" | "phone" | "in_person" | "async"> = [
  "video",
  "phone",
  "in_person",
  "async",
];

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(value: string[] | null | undefined): string {
  return (value ?? []).join(", ");
}

function buildInitialState(
  currentUserProfile: MentorProfileRecord | null,
  suggestedDefaults: MentorProfileSuggestedDefaults | null
) {
  return {
    bio: currentUserProfile?.bio ?? suggestedDefaults?.bio ?? "",
    expertiseAreas: joinCsv(currentUserProfile?.expertise_areas),
    topics: joinCsv(currentUserProfile?.topics),
    sports: joinCsv(currentUserProfile?.sports),
    positions: joinCsv(currentUserProfile?.positions ?? suggestedDefaults?.positions),
    industries: joinCsv(currentUserProfile?.industries ?? suggestedDefaults?.industries),
    roleFamilies: joinCsv(
      currentUserProfile?.role_families ?? suggestedDefaults?.role_families
    ),
    maxMentees: String(currentUserProfile?.max_mentees ?? 3),
    acceptingNew: currentUserProfile?.accepting_new ?? true,
    meetingPreferences: currentUserProfile?.meeting_preferences ?? [],
    timeCommitment: currentUserProfile?.time_commitment ?? "",
    yearsOfExperience:
      currentUserProfile?.years_of_experience != null
        ? String(currentUserProfile.years_of_experience)
        : "",
  };
}

export function MentorProfileForm({
  orgId,
  currentUserProfile,
  suggestedDefaults,
  onCancel,
  onSaved,
}: {
  orgId: string;
  currentUserProfile: MentorProfileRecord | null;
  suggestedDefaults: MentorProfileSuggestedDefaults | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const initialState = useMemo(
    () => buildInitialState(currentUserProfile, suggestedDefaults),
    [currentUserProfile, suggestedDefaults]
  );

  const [bio, setBio] = useState(initialState.bio);
  const [expertiseAreas, setExpertiseAreas] = useState(initialState.expertiseAreas);
  const [topics, setTopics] = useState(initialState.topics);
  const [sports, setSports] = useState(initialState.sports);
  const [positions, setPositions] = useState(initialState.positions);
  const [industries, setIndustries] = useState(initialState.industries);
  const [roleFamilies, setRoleFamilies] = useState(initialState.roleFamilies);
  const [maxMentees, setMaxMentees] = useState(initialState.maxMentees);
  const [acceptingNew, setAcceptingNew] = useState(initialState.acceptingNew);
  const [meetingPreferences, setMeetingPreferences] = useState(
    initialState.meetingPreferences
  );
  const [timeCommitment, setTimeCommitment] = useState(initialState.timeCommitment);
  const [yearsOfExperience, setYearsOfExperience] = useState(
    initialState.yearsOfExperience
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBio(initialState.bio);
    setExpertiseAreas(initialState.expertiseAreas);
    setTopics(initialState.topics);
    setSports(initialState.sports);
    setPositions(initialState.positions);
    setIndustries(initialState.industries);
    setRoleFamilies(initialState.roleFamilies);
    setMaxMentees(initialState.maxMentees);
    setAcceptingNew(initialState.acceptingNew);
    setMeetingPreferences(initialState.meetingPreferences);
    setTimeCommitment(initialState.timeCommitment);
    setYearsOfExperience(initialState.yearsOfExperience);
  }, [initialState]);

  const toggleMeetingPreference = (
    value: (typeof MEETING_OPTIONS)[number]
  ) => {
    setMeetingPreferences((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const handleSave = async () => {
    const parsedMaxMentees = Math.max(0, Number.parseInt(maxMentees, 10) || 0);
    const parsedYears =
      yearsOfExperience.trim().length > 0
        ? Math.max(0, Number.parseInt(yearsOfExperience, 10) || 0)
        : null;

    const payload: MentorProfilePayload = {
      bio: bio.trim(),
      expertise_areas: parseCsv(expertiseAreas),
      topics: parseCsv(topics),
      sports: parseCsv(sports),
      positions: parseCsv(positions),
      industries: parseCsv(industries),
      role_families: parseCsv(roleFamilies),
      max_mentees: parsedMaxMentees,
      accepting_new: acceptingNew,
      meeting_preferences: meetingPreferences,
      time_commitment: timeCommitment.trim(),
      years_of_experience: parsedYears,
    };

    setIsSaving(true);
    setError(null);

    try {
      await saveMentorProfile(orgId, payload);
      onSaved();
    } catch (saveError) {
      setError((saveError as Error).message || "Failed to save mentor profile.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.profileFormCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {currentUserProfile ? "Edit mentor profile" : "Become a mentor"}
        </Text>
        <Text style={styles.sectionSubtitle}>
          Share the areas where you can help so members can find the right fit.
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Field
        label="Bio"
        value={bio}
        onChangeText={setBio}
        placeholder="Tell members about your background and how you can help."
        multiline
        textArea
      />
      <Field
        label="Expertise"
        value={expertiseAreas}
        onChangeText={setExpertiseAreas}
        placeholder="Interview prep, career transitions, leadership"
        helperText="Separate multiple values with commas."
      />
      <Field
        label="Topics"
        value={topics}
        onChangeText={setTopics}
        placeholder="College recruiting, networking, first jobs"
        helperText="Separate multiple values with commas."
      />
      <Field
        label="Sports"
        value={sports}
        onChangeText={setSports}
        placeholder="Lacrosse, soccer, swimming"
        helperText="Separate multiple values with commas."
      />
      <Field
        label="Positions"
        value={positions}
        onChangeText={setPositions}
        placeholder="Goalie, midfielder, captain"
        helperText="Separate multiple values with commas."
      />
      <Field
        label="Industries"
        value={industries}
        onChangeText={setIndustries}
        placeholder="Healthcare, finance, software"
        helperText="Separate multiple values with commas."
      />
      <Field
        label="Job fields"
        value={roleFamilies}
        onChangeText={setRoleFamilies}
        placeholder="Product, design, sales"
        helperText="Separate multiple values with commas."
      />

      <View style={styles.twoColumnRow}>
        <View style={styles.twoColumnField}>
          <Field
            label="Max mentees"
            value={maxMentees}
            onChangeText={setMaxMentees}
            placeholder="3"
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.twoColumnField}>
          <Field
            label="Years of experience"
            value={yearsOfExperience}
            onChangeText={setYearsOfExperience}
            placeholder="10"
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Field
        label="Time commitment"
        value={timeCommitment}
        onChangeText={setTimeCommitment}
        placeholder="30 minutes"
      />

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Meeting preferences</Text>
        <View style={styles.chipRow}>
          {MEETING_OPTIONS.map((option) => {
            const active = meetingPreferences.includes(option);
            return (
              <Pressable
                key={option}
                onPress={() => toggleMeetingPreference(option)}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.chipPressed,
                ]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {option.replace("_", " ")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleLabel}>Accepting new mentees</Text>
          <Text style={styles.toggleHint}>
            Turn this off to stay in the directory without new requests.
          </Text>
        </View>
        <Switch
          value={acceptingNew}
          onValueChange={setAcceptingNew}
          trackColor={{
            false: styles.trackOff.color,
            true: styles.trackOn.color,
          }}
          thumbColor={acceptingNew ? styles.thumbOn.color : styles.thumbOff.color}
        />
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.ghostButton,
            pressed && styles.ghostButtonPressed,
          ]}
        >
          <Text style={styles.ghostButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
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
              {currentUserProfile ? "Save profile" : "Create profile"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  helperText,
  multiline = false,
  textArea = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  helperText?: string;
  multiline?: boolean;
  textArea?: boolean;
  keyboardType?: "default" | "number-pad";
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={styles.placeholderColor.color}
        multiline={multiline}
        textAlignVertical={textArea ? "top" : "center"}
        keyboardType={keyboardType}
        style={[styles.input, textArea && styles.textArea]}
      />
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    profileFormCard: {
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.divider,
      padding: SPACING.md,
      gap: SPACING.md,
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
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: n.secondary,
    },
    helperText: {
      fontSize: 12,
      color: n.muted,
    },
    placeholderColor: {
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 16,
      color: n.foreground,
      backgroundColor: n.background,
    },
    textArea: {
      minHeight: 96,
    },
    twoColumnRow: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    twoColumnField: {
      flex: 1,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    chip: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipActive: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    chipPressed: {
      opacity: 0.85,
    },
    chipText: {
      fontSize: 13,
      color: n.foreground,
      textTransform: "capitalize",
    },
    chipTextActive: {
      color: "#ffffff",
      fontWeight: "600",
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: SPACING.md,
    },
    toggleText: {
      flex: 1,
      gap: 2,
    },
    toggleLabel: {
      fontSize: 14,
      color: n.foreground,
      fontWeight: "500",
    },
    toggleHint: {
      fontSize: 12,
      color: n.muted,
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
      minWidth: 132,
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
