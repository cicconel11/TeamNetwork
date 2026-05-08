import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { X, ImagePlus, BarChart2 } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { MediaPickerBar } from "@/components/feed/MediaPickerBar";
import { PollBuilder } from "@/components/feed/PollBuilder";
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

type ComposerMode = "text" | "poll";

export default function NewPostScreen() {
  const router = useRouter();
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { isAdmin, isActiveMember } = useOrgRole();
  const canCreatePost = isAdmin || isActiveMember;
  const userId = user?.id ?? null;
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("text");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [allowChange, setAllowChange] = useState(false);
  const insets = useSafeAreaInsets();
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
      minHeight: 140,
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
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderTopWidth: 0.5,
      borderTopColor: n.border,
      backgroundColor: n.surface,
    },
    toolButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    toolButtonActive: {
      backgroundColor: n.foreground,
      borderColor: n.foreground,
    },
    toolButtonDisabled: {
      opacity: 0.4,
    },
    toolButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    toolButtonTextActive: {
      color: n.surface,
    },
  }));

  const { images, isUploading, addImages, removeImage, uploadAll, reset, setMountedRef } =
    useMediaUpload(orgId);

  useEffect(() => {
    setMountedRef(true);
    return () => setMountedRef(false);
  }, [setMountedRef]);

  const trimmedPollOptions = useMemo(
    () => pollOptions.map((o) => o.trim()).filter((o) => o.length > 0),
    [pollOptions],
  );

  const canSubmit = useMemo(() => {
    if (submitting || isUploading || !canCreatePost) return false;
    if (mode === "poll") {
      return body.trim().length > 0 && trimmedPollOptions.length >= 2;
    }
    return body.trim().length > 0 || images.length > 0;
  }, [submitting, isUploading, canCreatePost, mode, body, trimmedPollOptions, images.length]);

  const remaining = MAX_BODY_LENGTH - body.length;
  const submitLabel = isUploading
    ? "Uploading..."
    : submitting
      ? "Posting..."
      : "Post";

  const handlePickImages = useCallback(async () => {
    if (mode === "poll") {
      setMode("text");
    }

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
  }, [images.length, addImages, mode]);

  const handleTogglePoll = useCallback(() => {
    if (mode === "poll") {
      setMode("text");
      return;
    }
    if (images.length > 0) {
      reset();
    }
    setMode("poll");
  }, [mode, images.length, reset]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !userId || !orgId) return;

    setSubmitting(true);
    try {
      if (mode === "poll") {
        const response = await fetchWithAuth("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            body: body.trim(),
            poll: {
              question: body.trim(),
              options: trimmedPollOptions,
              allow_change: allowChange,
            },
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to create poll");
        }
      } else {
        let mediaIds: string[] = [];
        if (images.length > 0) {
          mediaIds = await uploadAll();
          if (mediaIds.length === 0) {
            const firstError = images.find((img) => img.error)?.error;
            showToast(
              firstError ? `Upload failed: ${firstError}` : "Image upload failed. Please try again.",
              "error"
            );
            setSubmitting(false);
            return;
          }
        }

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
      }

      reset();
      showToast(mode === "poll" ? "Poll created" : "Post created");
      router.back();
    } catch (e) {
      const message = (e as Error).message || "Failed to create post";
      showToast(message, "error");
      sentry.captureException(e as Error, { context: "NewPost.submit", orgId });
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    userId,
    orgId,
    mode,
    body,
    images,
    uploadAll,
    reset,
    router,
    trimmedPollOptions,
    allowChange,
  ]);

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

  const photoActive = mode === "text" && images.length > 0;
  const pollActive = mode === "poll";
  const photoDisabled = isUploading;

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
            placeholder={mode === "poll" ? "Ask a question..." : "What's on your mind?"}
            placeholderTextColor={neutral.placeholder}
            multiline
            autoFocus
            value={body}
            onChangeText={setBody}
            maxLength={MAX_BODY_LENGTH}
            textAlignVertical="top"
          />
          {mode === "poll" && (
            <PollBuilder
              options={pollOptions}
              onOptionsChange={setPollOptions}
              allowChange={allowChange}
              onAllowChangeToggle={setAllowChange}
            />
          )}
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

        {mode === "text" && images.length > 0 && (
          <MediaPickerBar
            images={images}
            isUploading={isUploading}
            onAddPress={handlePickImages}
            onRemove={removeImage}
            maxImages={MAX_IMAGES}
          />
        )}

        <View
          style={[
            styles.toolbar,
            { paddingBottom: SPACING.sm + insets.bottom },
          ]}
        >
          <Pressable
            onPress={handlePickImages}
            disabled={photoDisabled}
            style={[
              styles.toolButton,
              photoActive && styles.toolButtonActive,
              photoDisabled && styles.toolButtonDisabled,
            ]}
            accessibilityLabel="Add photos"
            accessibilityRole="button"
          >
            <ImagePlus
              size={18}
              color={photoActive ? neutral.surface : neutral.foreground}
            />
            <Text
              style={[
                styles.toolButtonText,
                photoActive && styles.toolButtonTextActive,
              ]}
            >
              Photo
            </Text>
          </Pressable>

          <Pressable
            onPress={handleTogglePoll}
            style={[
              styles.toolButton,
              pollActive && styles.toolButtonActive,
            ]}
            accessibilityLabel={pollActive ? "Remove poll" : "Add poll"}
            accessibilityRole="button"
          >
            <BarChart2
              size={18}
              color={pollActive ? neutral.surface : neutral.foreground}
            />
            <Text
              style={[
                styles.toolButtonText,
                pollActive && styles.toolButtonTextActive,
              ]}
            >
              Poll
            </Text>
          </Pressable>
        </View>

      </KeyboardAvoidingView>
    </View>
  );
}
