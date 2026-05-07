import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { SelectField, SelectModal } from "@/components/ui";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  PARENT_RELATIONSHIPS,
  type ParentFormValues,
} from "@/lib/parents";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface ParentFormProps {
  title: string;
  submitLabel: string;
  values: ParentFormValues;
  error: string | null;
  submitting: boolean;
  onChange: (field: keyof ParentFormValues, value: string) => void;
  onSubmit: () => void;
}

export function ParentForm({
  title,
  submitLabel,
  values,
  error,
  submitting,
  onChange,
  onSubmit,
}: ParentFormProps) {
  const router = useRouter();
  const [relationshipPickerOpen, setRelationshipPickerOpen] = useState(false);

  const relationshipOptions = useMemo(
    () => PARENT_RELATIONSHIPS.map((relationship) => ({ label: relationship, value: relationship })),
    []
  );

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
      minHeight: 44,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
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
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    introText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      backgroundColor: n.background,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    notesInput: {
      minHeight: 120,
      textAlignVertical: "top" as const,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderColor: s.error,
      borderWidth: 1,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    submitButton: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
      minHeight: 52,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
  }));

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={20} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>{title}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.contentSheet}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.introText}>
            Keep parent directory records current so families can be reached quickly.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={styles.input}
              value={values.first_name}
              onChangeText={(value) => onChange("first_name", value)}
              placeholder="Jordan"
              autoCapitalize="words"
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Last name</Text>
            <TextInput
              style={styles.input}
              value={values.last_name}
              onChangeText={(value) => onChange("last_name", value)}
              placeholder="Smith"
              autoCapitalize="words"
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={values.email}
              onChangeText={(value) => onChange("email", value)}
              placeholder="jordan@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.input}
              value={values.phone_number}
              onChangeText={(value) => onChange("phone_number", value)}
              placeholder="(555) 555-5555"
              keyboardType="phone-pad"
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Student name</Text>
            <TextInput
              style={styles.input}
              value={values.student_name}
              onChangeText={(value) => onChange("student_name", value)}
              placeholder="Student connected to this parent"
              autoCapitalize="words"
              editable={!submitting}
            />
          </View>

          <SelectField
            label="Relationship"
            value={values.relationship}
            placeholder="Select relationship"
            onPress={() => setRelationshipPickerOpen(true)}
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LinkedIn</Text>
            <TextInput
              style={styles.input}
              value={values.linkedin_url}
              onChangeText={(value) => onChange("linkedin_url", value)}
              placeholder="https://linkedin.com/in/..."
              keyboardType="url"
              autoCapitalize="none"
              editable={!submitting}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={values.notes}
              onChangeText={(value) => onChange("notes", value)}
              placeholder="Anything staff should know about this parent record"
              multiline
              editable={!submitting}
            />
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.submitButton,
              submitting && styles.submitButtonDisabled,
              pressed && !submitting && { opacity: 0.9 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>{submitLabel}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <SelectModal
        visible={relationshipPickerOpen}
        title="Relationship"
        options={relationshipOptions}
        selectedValue={values.relationship || null}
        onSelect={(option) => {
          onChange("relationship", option.value);
          setRelationshipPickerOpen(false);
        }}
        onClose={() => setRelationshipPickerOpen(false)}
      />
    </View>
  );
}
