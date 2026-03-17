import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ChevronLeft, Camera } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { z } from "@teammeet/validation";
import { useAuth } from "@/hooks/useAuth";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  bio: z.string().max(160, "Bio must be 160 characters or less").optional(),
  class_year: z
    .number()
    .int()
    .min(1900, "Class year must be 1900 or later")
    .max(2100, "Class year must be 2100 or earlier")
    .optional(),
  position: z.string().max(50, "Position must be 50 characters or less").optional(),
});

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const userMeta = (user?.user_metadata ?? {}) as {
    name?: string;
    avatar_url?: string;
    bio?: string;
    class_year?: number;
    position?: string;
  };

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [classYear, setClassYear] = useState("");
  const [position, setPosition] = useState("");
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isUploading, error: uploadError, pickAndUpload } = useAvatarUpload(user?.id);

  const avatarUrl = localAvatarUrl ?? userMeta.avatar_url ?? null;
  const initial = (name || userMeta.name || user?.email || "U").charAt(0).toUpperCase();

  useEffect(() => {
    if (user) {
      setName(userMeta.name ?? "");
      setBio(userMeta.bio ?? "");
      setClassYear(userMeta.class_year != null ? String(userMeta.class_year) : "");
      setPosition(userMeta.position ?? "");
    }
  }, [user]);

  useEffect(() => {
    if (uploadError) {
      setError(uploadError);
    }
  }, [uploadError]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleAvatarPress = useCallback(async () => {
    const newUrl = await pickAndUpload();
    if (newUrl) {
      setLocalAvatarUrl(newUrl);
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [pickAndUpload]);

  const handleSave = useCallback(async () => {
    setError(null);

    const parsedClassYear =
      classYear.trim().length > 0 ? parseInt(classYear.trim(), 10) : undefined;

    const parseResult = profileSchema.safeParse({
      name: name.trim(),
      bio: bio.trim().length > 0 ? bio.trim() : undefined,
      class_year: parsedClassYear,
      position: position.trim().length > 0 ? position.trim() : undefined,
    });

    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      setError(firstIssue?.message ?? "Invalid input");
      return;
    }

    const { name: validName, bio: validBio, class_year, position: validPosition } = parseResult.data;

    setIsSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          name: validName,
          bio: validBio ?? null,
          class_year: class_year ?? null,
          position: validPosition ?? null,
        },
      });

      if (updateError) {
        throw updateError;
      }

      router.back();
    } catch (e) {
      setError((e as Error).message || "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  }, [name, bio, classYear, position, router]);

  const isLoading = isSaving || isUploading;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Edit Profile</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        >
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <Pressable
              onPress={handleAvatarPress}
              disabled={isUploading}
              style={styles.avatarWrapper}
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>{initial}</Text>
                </View>
              )}
              <View style={styles.cameraOverlay}>
                {isUploading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Camera size={16} color="#ffffff" />
                )}
              </View>
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Name Field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
              autoCapitalize="words"
            />
          </View>

          {/* Email Field (read-only) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={styles.readOnlyField}>
              <Text selectable style={styles.readOnlyText}>
                {user?.email ?? ""}
              </Text>
            </View>
            <Text style={styles.fieldHint}>Email cannot be changed</Text>
          </View>

          {/* Additional Fields */}
          <Animated.View entering={FadeInDown.duration(300).delay(100)} style={styles.additionalFields}>
            {/* Bio Field */}
            <View style={styles.fieldGroup}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>Bio</Text>
                <Text style={[styles.fieldHint, styles.charCounter]}>
                  <Text style={{ fontVariant: ["tabular-nums"] }}>{bio.length}</Text>
                  /160
                </Text>
              </View>
              <TextInput
                value={bio}
                onChangeText={(text) => setBio(text.slice(0, 160))}
                placeholder="Tell your teammates about yourself"
                placeholderTextColor={NEUTRAL.placeholder}
                style={[styles.input, styles.textArea]}
                multiline
                numberOfLines={3}
                maxLength={160}
                autoCapitalize="sentences"
              />
            </View>

            {/* Class Year Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Class Year</Text>
              <TextInput
                value={classYear}
                onChangeText={(text) => setClassYear(text.replace(/\D/g, "").slice(0, 4))}
                placeholder="e.g. 2026"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            {/* Position Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Position</Text>
              <TextInput
                value={position}
                onChangeText={(text) => setPosition(text.slice(0, 50))}
                placeholder="e.g. Captain, Forward"
                placeholderTextColor={NEUTRAL.placeholder}
                style={styles.input}
                autoCapitalize="words"
                maxLength={50}
              />
            </View>
          </Animated.View>

          <Pressable
            onPress={handleSave}
            disabled={isLoading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isLoading && styles.buttonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save Changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {},
  headerSafeArea: {},
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  avatarSection: {
    alignItems: "center",
    paddingVertical: SPACING.lg,
  },
  avatarWrapper: {
    position: "relative",
    width: 120,
    height: 120,
    boxShadow: "0px 4px 16px rgba(0, 0, 0, 0.12)",
    borderRadius: 60,
  } as any,
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: SEMANTIC.successLight,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholderText: {
    fontSize: 48,
    fontWeight: "600",
    color: SEMANTIC.successDark,
  },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: SEMANTIC.info,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: NEUTRAL.surface,
  },
  errorCard: {
    backgroundColor: SEMANTIC.errorLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: SEMANTIC.error,
  },
  errorText: {
    ...TYPOGRAPHY.bodySmall,
    color: SEMANTIC.error,
  },
  fieldGroup: {
    gap: SPACING.xs,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldLabel: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  charCounter: {
    textAlign: "right",
  },
  input: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    backgroundColor: NEUTRAL.surface,
  } as any,
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: NEUTRAL.border,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: NEUTRAL.background,
  } as any,
  readOnlyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
  },
  fieldHint: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
  },
  additionalFields: {
    gap: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: SEMANTIC.success,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
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
});
