import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useNavigation } from "expo-router";
import { ChevronLeft, Receipt } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { supabase } from "@/lib/supabase";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

// Local colors for expenses screen
const EXPENSES_COLORS = {
  background: "#ffffff",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBackground: "#fef2f2",
  inputBackground: "#f8fafc",
};

export default function NewExpenseScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const styles = useMemo(() => createStyles(), []);

  const [formData, setFormData] = useState({
    name: "",
    expense_type: "",
    amount: "",
    venmo_link: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill user's name
  useEffect(() => {
    async function loadUserName() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.name) {
          setFormData((prev) => ({ ...prev, name: profile.name || "" }));
        }
      }
    }
    loadUserName();
  }, []);

  // Safe drawer toggle
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const handleGoBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSubmit = async () => {
    setError(null);

    // Validation
    if (!formData.name.trim()) {
      setError("Please enter a name");
      return;
    }
    if (!formData.expense_type.trim()) {
      setError("Please enter an expense type");
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount greater than 0");
      return;
    }

    setIsLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("You must be logged in to submit an expense");
        setIsLoading(false);
        return;
      }

      let resolvedOrgId = orgId;
      if (!resolvedOrgId) {
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .maybeSingle();
        resolvedOrgId = org?.id || null;
      }

      if (!resolvedOrgId) {
        setError("Organization not found");
        setIsLoading(false);
        return;
      }

      const { error: insertError } = await supabase.from("expenses").insert({
        organization_id: resolvedOrgId,
        user_id: user.id,
        name: formData.name.trim(),
        expense_type: formData.expense_type.trim(),
        amount: amount,
        venmo_link: formData.venmo_link.trim() || null,
      });

      if (insertError) {
        setError(insertError.message);
        setIsLoading(false);
        return;
      }

      // Success - navigate back
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (
      formData.name ||
      formData.expense_type ||
      formData.amount ||
      formData.venmo_link
    ) {
      Alert.alert(
        "Discard Changes",
        "Are you sure you want to discard your changes?",
        [
          { text: "Keep Editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            {/* Back Button */}
            <Pressable onPress={handleGoBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>

            {/* Text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Submit Expense</Text>
              <Text style={styles.headerMeta}>Request reimbursement</Text>
            </View>

            {/* Logo */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Form */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Error Message */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Form Card */}
          <View style={styles.formCard}>
            {/* Name Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={formData.name}
                onChangeText={(text) =>
                  setFormData({ ...formData, name: text })
                }
                placeholder="Person requesting reimbursement"
                placeholderTextColor={EXPENSES_COLORS.mutedText}
                autoCapitalize="words"
              />
            </View>

            {/* Expense Type Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Expense</Text>
              <TextInput
                style={styles.input}
                value={formData.expense_type}
                onChangeText={(text) =>
                  setFormData({ ...formData, expense_type: text })
                }
                placeholder="e.g., Travel, Equipment, Food"
                placeholderTextColor={EXPENSES_COLORS.mutedText}
                autoCapitalize="words"
              />
            </View>

            {/* Amount Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Amount</Text>
              <View style={styles.amountInputContainer}>
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  value={formData.amount}
                  onChangeText={(text) => {
                    // Only allow numbers and one decimal point
                    const cleaned = text.replace(/[^0-9.]/g, "");
                    const parts = cleaned.split(".");
                    if (parts.length > 2) return;
                    if (parts[1] && parts[1].length > 2) return;
                    setFormData({ ...formData, amount: cleaned });
                  }}
                  placeholder="0.00"
                  placeholderTextColor={EXPENSES_COLORS.mutedText}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* Venmo Link Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Venmo Request Link</Text>
              <TextInput
                style={styles.input}
                value={formData.venmo_link}
                onChangeText={(text) =>
                  setFormData({ ...formData, venmo_link: text })
                }
                placeholder="https://venmo.com/..."
                placeholderTextColor={EXPENSES_COLORS.mutedText}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.helperText}>
                Paste your Venmo payment request link (optional)
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && { opacity: 0.7 }]}
              onPress={handleCancel}
              disabled={isLoading}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                isLoading && styles.submitButtonDisabled,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleSubmit}
              disabled={isLoading}
            >
              <Text style={styles.submitButtonText}>
                {isLoading ? "Submitting..." : "Submit Expense"}
              </Text>
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
      backgroundColor: EXPENSES_COLORS.background,
    },
    // Header styles
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    // Keyboard avoiding view
    keyboardAvoid: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    // Error banner
    errorBanner: {
      backgroundColor: EXPENSES_COLORS.errorBackground,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    errorText: {
      color: EXPENSES_COLORS.error,
      fontSize: fontSize.sm,
    },
    // Form card
    formCard: {
      backgroundColor: EXPENSES_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      padding: spacing.md,
      gap: spacing.lg,
    },
    // Input group
    inputGroup: {
      gap: spacing.xs,
    },
    inputLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: EXPENSES_COLORS.primaryText,
    },
    input: {
      backgroundColor: EXPENSES_COLORS.inputBackground,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      fontSize: fontSize.base,
      color: EXPENSES_COLORS.primaryText,
    },
    amountInputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: EXPENSES_COLORS.inputBackground,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      paddingHorizontal: spacing.md,
    },
    currencySymbol: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: EXPENSES_COLORS.secondaryText,
      marginRight: 4,
    },
    amountInput: {
      flex: 1,
      paddingVertical: 12,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: EXPENSES_COLORS.primaryText,
    },
    helperText: {
      fontSize: fontSize.xs,
      color: EXPENSES_COLORS.mutedText,
      marginTop: 4,
    },
    // Button row
    buttonRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    cancelButton: {
      flex: 1,
      backgroundColor: EXPENSES_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      paddingVertical: 14,
      alignItems: "center",
    },
    cancelButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: EXPENSES_COLORS.secondaryText,
    },
    submitButton: {
      flex: 2,
      backgroundColor: EXPENSES_COLORS.primaryCTA,
      borderRadius: borderRadius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: EXPENSES_COLORS.primaryCTAText,
    },
  });
