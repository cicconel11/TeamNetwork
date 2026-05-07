import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Check, Circle, Square, CheckSquare } from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import type { Form, FormField, FormFieldOption, FormSubmission, Json } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatDefaultDate } from "@/lib/date-format";

function isFormFieldOption(value: unknown): value is FormFieldOption {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function isFormField(value: unknown): value is FormField {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const field = value as {
    name?: unknown;
    label?: unknown;
    type?: unknown;
    options?: unknown;
  };

  if (
    typeof field.name !== "string" ||
    typeof field.label !== "string" ||
    typeof field.type !== "string"
  ) {
    return false;
  }

  if (field.options === undefined) {
    return true;
  }

  return (
    Array.isArray(field.options) &&
    field.options.every(
      (option) => typeof option === "string" || isFormFieldOption(option)
    )
  );
}

function parseFormFields(value: unknown): FormField[] {
  return Array.isArray(value) ? value.filter(isFormField) : [];
}

function parseResponseMap(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getOptionValue(option: string | FormFieldOption): string {
  return typeof option === "string" ? option : option.value;
}

function getOptionLabel(option: string | FormFieldOption): string {
  return typeof option === "string" ? option : option.label;
}

export default function FormDetailScreen() {
  const { formId, orgSlug: paramOrgSlug } = useLocalSearchParams<{ formId: string; orgSlug: string }>();
  const { orgSlug: contextOrgSlug } = useOrg();
  const orgSlug = paramOrgSlug || contextOrgSlug;
  const router = useRouter();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    } as const,
    headerGradient: {
      paddingBottom: SPACING.xs,
    } as const,
    headerSafeArea: {} as const,
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    } as const,
    backButton: {
      width: 32,
      height: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    } as const,
    headerTextContainer: {
      flex: 1,
    } as const,
    headerTitle: {
      ...TYPOGRAPHY.headlineSmall,
      color: APP_CHROME.headerTitle,
    } as const,
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    } as const,
    scrollView: {
      flex: 1,
    } as const,
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    } as const,
    description: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      marginBottom: SPACING.md,
    } as const,
    infoBanner: {
      backgroundColor: s.infoLight,
      padding: SPACING.md,
      borderRadius: RADIUS.lg,
      marginBottom: SPACING.md,
    } as const,
    infoBannerText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.infoDark,
    } as const,
    errorBanner: {
      backgroundColor: s.errorLight,
      padding: SPACING.md,
      borderRadius: RADIUS.lg,
      marginBottom: SPACING.md,
    } as const,
    errorBannerText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
    } as const,
    fieldContainer: {
      marginBottom: SPACING.lg,
    } as const,
    fieldLabel: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
      marginBottom: SPACING.sm,
    } as const,
    input: {
      backgroundColor: n.surface,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
    } as const,
    inputText: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
    } as const,
    inputPlaceholder: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.muted,
    } as const,
    textArea: {
      minHeight: 100,
      textAlignVertical: "top" as const,
    } as const,
    optionsContainer: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    } as const,
    selectOption: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    } as const,
    selectOptionSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    } as const,
    selectOptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    } as const,
    selectOptionTextSelected: {
      ...TYPOGRAPHY.labelLarge,
      color: s.successDark,
    } as const,
    radioContainer: {
      gap: SPACING.sm,
    } as const,
    radioOption: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.xs,
    } as const,
    radioSelected: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    } as const,
    radioUnselected: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: n.border,
    } as const,
    radioLabel: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
    } as const,
    checkboxContainer: {
      gap: SPACING.sm,
    } as const,
    checkboxOption: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.xs,
    } as const,
    checkboxLabel: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
    } as const,
    buttonContainer: {
      flexDirection: "row" as const,
      gap: SPACING.md,
      marginTop: SPACING.lg,
      paddingTop: SPACING.lg,
      borderTopWidth: 1,
      borderTopColor: n.border,
    } as const,
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    } as const,
    primaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    } as const,
    secondaryButton: {
      flex: 1,
      backgroundColor: n.surface,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    } as const,
    secondaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.secondary,
    } as const,
    buttonDisabled: {
      opacity: 0.6,
    } as const,
    successContainer: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
    } as const,
    successIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: s.successLight,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginBottom: SPACING.lg,
    } as const,
    successTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    } as const,
    successText: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.secondary,
      marginBottom: SPACING.xl,
    } as const,
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: 20,
      backgroundColor: n.background,
    } as const,
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
    } as const,
  }));

  const [form, setForm] = useState<Form | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<FormSubmission | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null);

  // Fetch form and existing submission
  useEffect(() => {
    let isMounted = true;

    async function loadForm() {
      if (!formId) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();

        // Fetch form
        const { data: formData, error: formError } = await supabase
          .from("forms")
          .select("*")
          .eq("id", formId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .single();

        if (formError || !formData) {
          if (isMounted) {
            setError("Form not found");
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setForm(formData as Form);
        }

        // Check for existing submission
        if (user) {
          const { data: submission } = await supabase
            .from("form_submissions")
            .select("*")
            .eq("form_id", formId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (submission && isMounted) {
            setExistingSubmission(submission as FormSubmission);
            // Use 'data' field if it exists, otherwise try 'responses' for backward compat
            const submissionRecord = submission as { data?: unknown; responses?: unknown };
            const submissionData = submissionRecord.data ?? submissionRecord.responses;
            setResponses(parseResponseMap(submissionData));
          }
        }

        if (isMounted) {
          setLoading(false);
        }
      } catch (e) {
        if (isMounted) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    loadForm();
    return () => { isMounted = false; };
  }, [formId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(app)/${orgSlug}/forms`);
    }
  }, [router, orgSlug]);

  const handleSubmit = async () => {
    if (!form) return;

    const fields = parseFormFields(form.fields);

    // Validate required fields
    for (const field of fields) {
      if (field.required) {
        const value = responses[field.name];
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
          setError(`"${field.label}" is required`);
          return;
        }
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError("You must be logged in");
        setSubmitting(false);
        return;
      }

      if (existingSubmission) {
        // Update existing submission
        const { error: updateError } = await supabase
          .from("form_submissions")
          .update({ responses: responses as Json, submitted_at: new Date().toISOString() })
          .eq("id", existingSubmission.id);

        if (updateError) throw updateError;
      } else {
        // Create new submission
        const { error: insertError } = await supabase
          .from("form_submissions")
          .insert({
            form_id: formId,
            organization_id: form.organization_id,
            user_id: user.id,
            responses: responses as Json,
          });

        if (insertError) throw insertError;
      }

      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateResponse = (fieldName: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [fieldName]: value }));
  };

  const renderField = (field: FormField) => {
    const label = field.required ? `${field.label} *` : field.label;
    const value = responses[field.name];

    switch (field.type) {
      case "textarea":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={(value as string) || ""}
              onChangeText={(text) => updateResponse(field.name, text)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              placeholderTextColor={neutral.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        );

      case "select":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.optionsContainer}>
              {(field.options || []).map((opt) => {
                const optionValue = getOptionValue(opt);
                const optionLabel = getOptionLabel(opt);
                return (
                  <Pressable
                    key={optionValue}
                    style={[styles.selectOption, value === optionValue && styles.selectOptionSelected]}
                    onPress={() => updateResponse(field.name, optionValue)}
                  >
                    <Text
                      style={[
                        styles.selectOptionText,
                        value === optionValue && styles.selectOptionTextSelected,
                      ]}
                    >
                      {optionLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );

      case "radio":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.radioContainer}>
              {(field.options || []).map((opt) => {
                const optionValue = getOptionValue(opt);
                const optionLabel = getOptionLabel(opt);
                return (
                  <Pressable
                    key={optionValue}
                    style={styles.radioOption}
                    onPress={() => updateResponse(field.name, optionValue)}
                  >
                    {value === optionValue ? (
                      <View style={styles.radioSelected}>
                        <Circle size={12} color={semantic.success} fill={semantic.success} />
                      </View>
                    ) : (
                      <View style={styles.radioUnselected} />
                    )}
                    <Text style={styles.radioLabel}>{optionLabel}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );

      case "checkbox": {
        const checkedValues = (value as string[]) || [];
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.checkboxContainer}>
              {(field.options || []).map((opt) => {
                const optionValue = getOptionValue(opt);
                const optionLabel = getOptionLabel(opt);
                const isChecked = checkedValues.includes(optionValue);
                return (
                  <Pressable
                    key={optionValue}
                    style={styles.checkboxOption}
                    onPress={() => {
                      if (isChecked) {
                        updateResponse(field.name, checkedValues.filter((v) => v !== optionValue));
                      } else {
                        updateResponse(field.name, [...checkedValues, optionValue]);
                      }
                    }}
                  >
                    {isChecked ? (
                      <CheckSquare size={20} color={semantic.success} />
                    ) : (
                      <Square size={20} color={neutral.border} />
                    )}
                    <Text style={styles.checkboxLabel}>{optionLabel}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      }

      case "date": {
        const dateValue = value ? new Date(value as string) : null;
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <Pressable
              style={styles.input}
              onPress={() => setShowDatePicker(field.name)}
            >
              <Text style={dateValue ? styles.inputText : styles.inputPlaceholder}>
                {dateValue ? formatDefaultDate(dateValue) : "Select date"}
              </Text>
            </Pressable>
            {showDatePicker === field.name && (
              <DateTimePicker
                value={dateValue || new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, selectedDate) => {
                  setShowDatePicker(null);
                  if (selectedDate) {
                    updateResponse(field.name, selectedDate.toISOString().split("T")[0]);
                  }
                }}
              />
            )}
          </View>
        );
      }

      case "email":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(value as string) || ""}
              onChangeText={(text) => updateResponse(field.name, text)}
              placeholder="Enter email"
              placeholderTextColor={neutral.muted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        );

      case "phone":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(value as string) || ""}
              onChangeText={(text) => updateResponse(field.name, text)}
              placeholder="Enter phone number"
              placeholderTextColor={neutral.muted}
              keyboardType="phone-pad"
            />
          </View>
        );

      default: // text
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(value as string) || ""}
              onChangeText={(text) => updateResponse(field.name, text)}
              placeholder={`Enter ${field.label.toLowerCase()}`}
              placeholderTextColor={neutral.muted}
            />
          </View>
        );
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={semantic.success} />
      </View>
    );
  }

  if (!form) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Form Not Found</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error || "Form not found"}</Text>
          </View>
        </View>
      </View>
    );
  }

  const fields = parseFormFields(form.fields);

  // Success state
  if (success) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle} numberOfLines={1}>{form.title}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Check size={48} color={semantic.success} />
            </View>
            <Text style={styles.successTitle}>
              {existingSubmission ? "Response Updated!" : "Form Submitted!"}
            </Text>
            <Text style={styles.successText}>Your response has been recorded.</Text>
            <Pressable style={styles.primaryButton} onPress={handleBack}>
              <Text style={styles.primaryButtonText}>Back to Forms</Text>
            </Pressable>
          </View>
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
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>{form.title}</Text>
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
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {form.description && (
            <Text style={styles.description}>{form.description}</Text>
          )}

          {existingSubmission && (
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                You have already submitted this form. You can update your response below.
              </Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          {fields.map(renderField)}

          <View style={styles.buttonContainer}>
            <Pressable
              style={styles.secondaryButton}
              onPress={handleBack}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {existingSubmission ? "Update Response" : "Submit"}
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
