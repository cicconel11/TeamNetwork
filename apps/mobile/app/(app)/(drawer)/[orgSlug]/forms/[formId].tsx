import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
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
import type { Form, FormField, FormSubmission } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL } from "@/lib/design-tokens";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { formatDefaultDate } from "@/lib/date-format";

const FORM_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBackground: "#fef2f2",
  infoBadge: "#dbeafe",
  infoText: "#1e40af",
  successBadge: "#d1fae5",
  successText: "#065f46",
  inputBackground: "#ffffff",
  inputBorder: "#d1d5db",
  inputFocusBorder: "#059669",
};

export default function FormDetailScreen() {
  const { formId, orgSlug: paramOrgSlug } = useLocalSearchParams<{ formId: string; orgSlug: string }>();
  const { orgSlug: contextOrgSlug } = useOrg();
  const orgSlug = paramOrgSlug || contextOrgSlug;
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);

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
            const submissionData = (submission as any).data || (submission as any).responses || {};
            setResponses(submissionData as Record<string, unknown>);
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

    const fields = (form.fields || []) as FormField[];

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
          .update({ data: responses, submitted_at: new Date().toISOString() })
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
            data: responses,
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
              placeholderTextColor={FORM_COLORS.mutedText}
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
              {(field.options || []).map((opt) => (
                <Pressable
                  key={opt}
                  style={[styles.selectOption, value === opt && styles.selectOptionSelected]}
                  onPress={() => updateResponse(field.name, opt)}
                >
                  <Text style={[styles.selectOptionText, value === opt && styles.selectOptionTextSelected]}>
                    {opt}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );

      case "radio":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.radioContainer}>
              {(field.options || []).map((opt) => (
                <Pressable
                  key={opt}
                  style={styles.radioOption}
                  onPress={() => updateResponse(field.name, opt)}
                >
                  {value === opt ? (
                    <View style={styles.radioSelected}>
                      <Circle size={12} color={FORM_COLORS.primaryCTA} fill={FORM_COLORS.primaryCTA} />
                    </View>
                  ) : (
                    <View style={styles.radioUnselected} />
                  )}
                  <Text style={styles.radioLabel}>{opt}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );

      case "checkbox":
        const checkedValues = (value as string[]) || [];
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.checkboxContainer}>
              {(field.options || []).map((opt) => {
                const isChecked = checkedValues.includes(opt);
                return (
                  <Pressable
                    key={opt}
                    style={styles.checkboxOption}
                    onPress={() => {
                      if (isChecked) {
                        updateResponse(field.name, checkedValues.filter((v) => v !== opt));
                      } else {
                        updateResponse(field.name, [...checkedValues, opt]);
                      }
                    }}
                  >
                    {isChecked ? (
                      <CheckSquare size={20} color={FORM_COLORS.primaryCTA} />
                    ) : (
                      <Square size={20} color={FORM_COLORS.inputBorder} />
                    )}
                    <Text style={styles.checkboxLabel}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );

      case "date":
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

      case "email":
        return (
          <View style={styles.fieldContainer} key={field.name}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(value as string) || ""}
              onChangeText={(text) => updateResponse(field.name, text)}
              placeholder="Enter email"
              placeholderTextColor={FORM_COLORS.mutedText}
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
              placeholderTextColor={FORM_COLORS.mutedText}
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
              placeholderTextColor={FORM_COLORS.mutedText}
            />
          </View>
        );
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={FORM_COLORS.primaryCTA} />
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

  const fields = (form.fields || []) as FormField[];

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
              <Check size={48} color={FORM_COLORS.primaryCTA} />
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
                <ActivityIndicator size="small" color={FORM_COLORS.primaryCTAText} />
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

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    backButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    description: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.secondaryText,
      marginBottom: spacing.md,
      lineHeight: 20,
    },
    infoBanner: {
      backgroundColor: FORM_COLORS.infoBadge,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    infoBannerText: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.infoText,
    },
    errorBanner: {
      backgroundColor: FORM_COLORS.errorBackground,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    errorBannerText: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.error,
    },
    fieldContainer: {
      marginBottom: spacing.lg,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: FORM_COLORS.primaryText,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: FORM_COLORS.inputBackground,
      borderWidth: 1,
      borderColor: FORM_COLORS.inputBorder,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      fontSize: fontSize.base,
      color: FORM_COLORS.primaryText,
    },
    inputText: {
      fontSize: fontSize.base,
      color: FORM_COLORS.primaryText,
    },
    inputPlaceholder: {
      fontSize: fontSize.base,
      color: FORM_COLORS.mutedText,
    },
    textArea: {
      minHeight: 100,
      textAlignVertical: "top",
    },
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    selectOption: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: FORM_COLORS.inputBorder,
      backgroundColor: FORM_COLORS.inputBackground,
    },
    selectOptionSelected: {
      borderColor: FORM_COLORS.primaryCTA,
      backgroundColor: FORM_COLORS.successBadge,
    },
    selectOptionText: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.primaryText,
    },
    selectOptionTextSelected: {
      color: FORM_COLORS.successText,
      fontWeight: fontWeight.medium,
    },
    radioContainer: {
      gap: spacing.sm,
    },
    radioOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    radioSelected: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: FORM_COLORS.primaryCTA,
      alignItems: "center",
      justifyContent: "center",
    },
    radioUnselected: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: FORM_COLORS.inputBorder,
    },
    radioLabel: {
      fontSize: fontSize.base,
      color: FORM_COLORS.primaryText,
    },
    checkboxContainer: {
      gap: spacing.sm,
    },
    checkboxOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    checkboxLabel: {
      fontSize: fontSize.base,
      color: FORM_COLORS.primaryText,
    },
    buttonContainer: {
      flexDirection: "row",
      gap: spacing.md,
      marginTop: spacing.lg,
      paddingTop: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: FORM_COLORS.border,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: FORM_COLORS.primaryCTA,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: FORM_COLORS.primaryCTAText,
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: FORM_COLORS.card,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: FORM_COLORS.border,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: FORM_COLORS.secondaryText,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    // Success state
    successContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
    },
    successIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: FORM_COLORS.successBadge,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },
    successTitle: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.semibold,
      color: FORM_COLORS.primaryText,
      marginBottom: spacing.sm,
    },
    successText: {
      fontSize: fontSize.base,
      color: FORM_COLORS.secondaryText,
      marginBottom: spacing.xl,
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: FORM_COLORS.background,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.error,
    },
  });
