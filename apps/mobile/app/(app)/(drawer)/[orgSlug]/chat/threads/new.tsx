import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { APP_CHROME } from "@/lib/chrome";

const FORM_COLORS = {
  background: "#ffffff",
  title: "#0f172a",
  subtitle: "#64748b",
  muted: "#94a3b8",
  border: "#e2e8f0",
  error: "#dc2626",
  accent: "#059669",
  input: "#f1f5f9",
};

export default function NewThreadScreen() {
  const { orgId, orgSlug } = useOrg();
  const { user } = useAuth();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const isMountedRef = useRef(true);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const validateForm = useCallback((): string | null => {
    if (title.trim().length < 3) {
      return "Title must be at least 3 characters";
    }
    if (body.trim().length < 10) {
      return "Description must be at least 10 characters";
    }
    return null;
  }, [title, body]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!orgId || !currentUserId) {
      setError("Missing organization or user context");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const { data, error: insertError } = await supabase
        .from("discussion_threads")
        .insert({
          organization_id: orgId,
          author_id: currentUserId,
          title: title.trim(),
          body: body.trim(),
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (isMountedRef.current && data) {
        // Navigate to the new thread using replace (not push) so back doesn't return to this form
        router.replace(`/(app)/${orgSlug}/chat/threads/${data.id}`);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message || "Failed to create thread");
        setSubmitting(false);
      }
    }
  }, [submitting, validateForm, orgId, currentUserId, router, orgSlug]);

  return (
    <View style={styles.container}>
      {/* Custom gradient header */}
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
              <Text style={styles.headerTitle}>New Thread</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.form}>
            {/* Title field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="What's on your mind?"
                placeholderTextColor={FORM_COLORS.muted}
                value={title}
                onChangeText={setTitle}
                editable={!submitting}
                maxLength={200}
                returnKeyType="next"
                autoFocus
              />
              <Text style={styles.charCount}>
                {title.length}/200
              </Text>
            </View>

            {/* Body field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Share more details about your topic..."
                placeholderTextColor={FORM_COLORS.muted}
                value={body}
                onChangeText={setBody}
                editable={!submitting}
                maxLength={10000}
                multiline
              />
              <Text style={styles.charCount}>
                {body.length}/10000
              </Text>
            </View>

            {/* Error banner */}
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit button */}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={({ pressed }) => [
                styles.submitButton,
                submitting && styles.submitButtonDisabled,
                pressed && !submitting && styles.submitButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create thread"
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>Create Thread</Text>
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
      backgroundColor: FORM_COLORS.background,
    },
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    backButton: {
      padding: spacing.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      padding: spacing.md,
    },
    form: {
      gap: spacing.lg,
    },
    fieldGroup: {
      gap: spacing.sm,
    },
    label: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: FORM_COLORS.title,
    },
    input: {
      backgroundColor: FORM_COLORS.input,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: FORM_COLORS.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: FORM_COLORS.title,
    },
    textArea: {
      minHeight: 120,
      paddingTop: spacing.md,
      textAlignVertical: "top",
    },
    charCount: {
      fontSize: fontSize.xs,
      color: FORM_COLORS.muted,
      textAlign: "right",
    },
    errorBanner: {
      backgroundColor: "rgba(220, 38, 38, 0.12)",
      borderRadius: borderRadius.md,
      borderLeftWidth: 3,
      borderLeftColor: FORM_COLORS.error,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: FORM_COLORS.error,
    },
    submitButton: {
      backgroundColor: FORM_COLORS.accent,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonPressed: {
      opacity: 0.8,
    },
    submitButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: "#ffffff",
    },
  });
