import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const MAX_BODY_LENGTH = 5000;

export default function NewPostScreen() {
  const router = useRouter();
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isActiveMember } = useOrgRole();
  const canCreatePost = isAdmin || isActiveMember;
  const userId = user?.id ?? null;
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const styles = useMemo(() => createStyles(), []);

  const canSubmit = body.trim().length > 0 && !submitting && canCreatePost;
  const remaining = MAX_BODY_LENGTH - body.length;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !userId || !orgId) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("feed_posts").insert({
        organization_id: orgId,
        author_id: userId,
        body: body.trim(),
      });
      if (error) throw error;
      showToast("Post created");
      router.back();
    } catch (e) {
      const message = (e as Error).message || "Failed to create post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "NewPost.submit", orgId });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, userId, orgId, body, router]);

  if (!canCreatePost) {
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
                <Text style={styles.headerTitle}>New Post</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={[styles.contentSheet, { justifyContent: "center", alignItems: "center" }]}>
          <Text style={{ ...TYPOGRAPHY.bodyMedium, color: SEMANTIC.error }}>
            You do not have permission to create posts.
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
              <Text style={styles.headerTitle}>New Post</Text>
            </View>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={[styles.postButton, !canSubmit && styles.postButtonDisabled]}
              accessibilityLabel="Post"
              accessibilityRole="button"
            >
              <Text style={[styles.postButtonText, !canSubmit && styles.postButtonTextDisabled]}>
                Post
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
            placeholderTextColor={NEUTRAL.placeholder}
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

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
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
    closeButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    postButton: {
      backgroundColor: NEUTRAL.surface,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.lg,
    },
    postButtonDisabled: {
      opacity: 0.4,
    },
    postButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.foreground,
      fontWeight: "600",
    },
    postButtonTextDisabled: {
      color: NEUTRAL.muted,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
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
      color: NEUTRAL.foreground,
      flex: 1,
      minHeight: 200,
      lineHeight: 22,
    },
    charCounter: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.sm,
      alignItems: "flex-end",
    },
    charCounterText: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
    },
    charCounterWarning: {
      color: SEMANTIC.warning,
    },
  });
