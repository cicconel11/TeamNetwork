import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, AlertTriangle, ShieldX } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { signOut } from "@/lib/supabase";

const CONFIRMATION_TEXT = "DELETE MY ACCOUNT";
const API_PATH = "/api/user/delete-account";

interface DeletionStatus {
  status: "none" | "pending" | "completed";
  requestedAt: string | null;
  scheduledDeletionAt: string | null;
}

export default function DeleteAccountScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ currentSlug?: string }>();
  const { neutral, semantic } = useAppColorScheme();
  const isMountedRef = useRef(true);

  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [confirmationText, setConfirmationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfirmed = confirmationText === CONFIRMATION_TEXT;
  const isPending = deletionStatus?.status === "pending";

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {},
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: {
      width: 36,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      gap: SPACING.sm,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    warningCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: s.error,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    warningHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    warningTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: s.error,
    },
    warningText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.errorDark,
    },
    sectionCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.md,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    bodyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    bulletList: {
      gap: SPACING.xs,
    },
    bulletItem: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      paddingLeft: SPACING.sm,
    },
    pendingCard: {
      backgroundColor: s.warningLight,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: s.warning,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    pendingTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: s.warningDark,
    },
    pendingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.warningDark,
    },
    pendingDate: {
      ...TYPOGRAPHY.titleSmall,
      color: s.warningDark,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      borderCurve: "continuous" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    inputLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    inputHint: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    fieldGroup: {
      gap: SPACING.xs,
    },
    dangerButton: {
      backgroundColor: s.error,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    dangerButtonPressed: {
      opacity: 0.9,
    },
    dangerButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    cancelButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    cancelButtonPressed: {
      opacity: 0.9,
    },
    cancelButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.error,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
  }));

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    setError(null);
    try {
      const response = await fetchWithAuth(API_PATH);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to check deletion status");
      }
      if (isMountedRef.current) {
        setDeletionStatus(data as DeletionStatus);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingStatus(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (params.currentSlug) {
      router.replace(`/(app)/${params.currentSlug}/(tabs)`);
      return;
    }

    router.replace("/(app)");
  }, [params.currentSlug, router]);

  const handleDelete = useCallback(async () => {
    if (!isConfirmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetchWithAuth(API_PATH, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: CONFIRMATION_TEXT }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.details
          ? `${data.error}: ${data.details}`
          : data.error;
        throw new Error(message || "Failed to delete account");
      }
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await signOut();
    } catch (err) {
      if (isMountedRef.current) {
        setError((err as Error).message);
        setIsSubmitting(false);
      }
    }
  }, [isConfirmed, signOut]);

  const handleCancelDeletion = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetchWithAuth(API_PATH, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel deletion");
      }
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      if (isMountedRef.current) {
        await fetchStatus();
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [fetchStatus]);

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return "Unknown";
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoadingStatus) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]} style={styles.headerGradient}>
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable
                onPress={handleBack}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Delete Account</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={APP_CHROME.headerTitle} />
            <Text style={styles.loadingText}>Checking account status...</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]} style={styles.headerGradient}>
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={handleBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Delete Account</Text>
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
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {isPending ? (
            <Animated.View entering={FadeInDown.duration(250)}>
              <View style={styles.pendingCard}>
                <View style={styles.warningHeader}>
                  <AlertTriangle size={20} color={semantic.warningDark} />
                  <Text style={styles.pendingTitle}>Deletion Scheduled</Text>
                </View>
                <Text style={styles.pendingText}>
                  Your account is scheduled for permanent deletion on:
                </Text>
                <Text style={styles.pendingDate}>
                  {formatDate(deletionStatus?.scheduledDeletionAt ?? null)}
                </Text>
                <Text style={styles.pendingText}>
                  You can cancel this request to keep your account active.
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {isPending ? (
            <Pressable
              onPress={handleCancelDeletion}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel account deletion"
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.cancelButtonPressed,
                isSubmitting && styles.buttonDisabled,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.cancelButtonText}>Cancel Deletion</Text>
              )}
            </Pressable>
          ) : null}

          {!isPending ? (
            <>
              <Animated.View entering={FadeInDown.duration(250)}>
                <View style={styles.warningCard}>
                  <View style={styles.warningHeader}>
                    <ShieldX size={20} color={semantic.error} />
                    <Text style={styles.warningTitle}>This action is irreversible</Text>
                  </View>
                  <Text style={styles.warningText}>
                    Requesting account deletion starts a 30-day grace period. After that, your
                    account and all associated data will be permanently deleted.
                  </Text>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(250).delay(80)}>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>What gets deleted</Text>
                  <View style={styles.bulletList}>
                    <Text style={styles.bulletItem}>{"\u2022"} Your profile and account data</Text>
                    <Text style={styles.bulletItem}>{"\u2022"} Organization memberships</Text>
                    <Text style={styles.bulletItem}>{"\u2022"} Messages and activity history</Text>
                    <Text style={styles.bulletItem}>{"\u2022"} Uploaded files and photos</Text>
                  </View>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(250).delay(160)}>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>Important</Text>
                  <Text style={styles.bodyText}>
                    If you are an admin of any organization, you must transfer admin rights or
                    delete the organization before deleting your account.
                  </Text>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(250).delay(240)}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>Type "{CONFIRMATION_TEXT}" to confirm</Text>
                  <TextInput
                    value={confirmationText}
                    onChangeText={setConfirmationText}
                    placeholder={CONFIRMATION_TEXT}
                    placeholderTextColor={neutral.placeholder}
                    style={styles.input}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <Text style={styles.inputHint}>
                    You can cancel within 30 days after submitting.
                  </Text>
                </View>
              </Animated.View>

              <Pressable
                onPress={handleDelete}
                disabled={!isConfirmed || isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Delete my account"
                style={({ pressed }) => [
                  styles.dangerButton,
                  pressed && styles.dangerButtonPressed,
                  (!isConfirmed || isSubmitting) && styles.buttonDisabled,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.dangerButtonText}>Delete My Account</Text>
                )}
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
