import { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { X } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { usePost } from "@/hooks/usePost";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const MAX_BODY_LENGTH = 5000;

export default function EditPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { post, loading } = usePost(postId);
  const { user } = useAuth();
  const { isAdmin } = useOrgRole();
  const [body, setBody] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    centered: {
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    unauthorizedText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
      textAlign: "center" as const,
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    closeButton: {
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
    saveButton: {
      backgroundColor: n.surface,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.lg,
    },
    saveButtonDisabled: {
      opacity: 0.4,
    },
    saveButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    saveButtonTextDisabled: {
      color: n.muted,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      flexGrow: 1,
    },
    bodyInput: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      flex: 1,
      minHeight: 200,
      lineHeight: 22,
    },
    charCounter: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.sm,
      alignItems: "flex-end" as const,
    },
    charCounterText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    charCounterWarning: {
      color: s.warning,
    },
  }));

  const canEdit = !post || !user ? null : post.author_id === user.id || isAdmin;

  // Pre-fill body from post
  useEffect(() => {
    if (post && !initialized) {
      setBody(post.body);
      setInitialized(true);
    }
  }, [post, initialized]);

  const canSubmit = body.trim().length > 0 && !submitting && body.trim() !== (post?.body ?? "");
  const remaining = MAX_BODY_LENGTH - body.length;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !postId) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("feed_posts")
        .update({ body: body.trim(), updated_at: new Date().toISOString() })
        .eq("id", postId);
      if (error) throw error;
      showToast("Post updated");
      router.back();
    } catch (e) {
      const message = (e as Error).message || "Failed to update post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "EditPost.submit", postId });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, postId, body, router]);

  if (loading && !post) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={neutral.muted} />
      </View>
    );
  }

  if (canEdit === false) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable
                onPress={() => router.back()}
                style={styles.closeButton}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <X size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Edit Post</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={[styles.contentSheet, styles.centered]}>
          <Text style={styles.unauthorizedText}>
            You are not authorized to edit this post.
          </Text>
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
            <Pressable
              onPress={() => router.back()}
              style={styles.closeButton}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <X size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Edit Post</Text>
            </View>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[styles.saveButton, !canSubmit && styles.saveButtonDisabled]}
              accessibilityLabel="Save changes"
              accessibilityRole="button"
            >
              <Text style={[styles.saveButtonText, !canSubmit && styles.saveButtonTextDisabled]}>
                Save
              </Text>
            </Pressable>
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
          <TextInput
            style={styles.bodyInput}
            placeholder="What's on your mind?"
            placeholderTextColor={neutral.placeholder}
            multiline
            autoFocus
            value={body}
            onChangeText={setBody}
            maxLength={MAX_BODY_LENGTH}
            textAlignVertical="top"
          />
        </ScrollView>
        {remaining < 1000 && (
          <View style={styles.charCounter}>
            <Text
              style={[
                styles.charCounterText,
                remaining < 100 && styles.charCounterWarning,
              ]}
            >
              {remaining} remaining
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
