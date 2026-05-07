import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { MediaPickerBar } from "@/components/feed/MediaPickerBar";
import { fetchWithAuth } from "@/lib/web-api";
import { useOrg } from "@/contexts/OrgContext";
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
const MAX_IMAGES = 4;

export default function NewPostScreen() {
  const router = useRouter();
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isActiveMember } = useOrgRole();
  const canCreatePost = isAdmin || isActiveMember;
  const userId = user?.id ?? null;
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
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
    postButton: {
      backgroundColor: n.surface,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.lg,
    },
    postButtonDisabled: {
      opacity: 0.4,
    },
    postButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    postButtonTextDisabled: {
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

  const { images, isUploading, addImages, removeImage, uploadAll, reset, setMountedRef } =
    useMediaUpload(orgId);

  useEffect(() => {
    setMountedRef(true);
    return () => setMountedRef(false);
  }, [setMountedRef]);

  const canSubmit = body.trim().length > 0 && !submitting && !isUploading && canCreatePost;
  const remaining = MAX_BODY_LENGTH - body.length;
  const submitLabel = isUploading
    ? "Uploading..."
    : submitting
      ? "Posting..."
      : "Post";

  const handlePickImages = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showToast("Photo library access is required to attach images", "error");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: MAX_IMAGES - images.length,
    });

    if (result.canceled || !result.assets) return;
    addImages(result.assets);
  }, [images.length, addImages]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !userId || !orgId) return;

    setSubmitting(true);
    try {
      // Upload images first (if any)
      let mediaIds: string[] = [];
      if (images.length > 0) {
        mediaIds = await uploadAll();
        // If all uploads failed, abort
        if (mediaIds.length === 0 && images.length > 0) {
          showToast("Image upload failed. Please try again.", "error");
          setSubmitting(false);
          return;
        }
      }

      // Create post via web API (handles media linking)
      const response = await fetchWithAuth("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          body: body.trim(),
          mediaIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create post");
      }

      reset();
      showToast("Post created");
      router.back();
    } catch (e) {
      const message = (e as Error).message || "Failed to create post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "NewPost.submit", orgId });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, userId, orgId, body, images, uploadAll, reset, router]);

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
          <Text style={{ ...TYPOGRAPHY.bodyMedium, color: semantic.error }}>
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
              accessibilityLabel={submitLabel}
              accessibilityRole="button"
            >
              <Text style={[styles.postButtonText, !canSubmit && styles.postButtonTextDisabled]}>
                {submitLabel}
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
        <MediaPickerBar
          images={images}
          isUploading={isUploading}
          onAddPress={handlePickImages}
          onRemove={removeImage}
          maxImages={MAX_IMAGES}
        />
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
