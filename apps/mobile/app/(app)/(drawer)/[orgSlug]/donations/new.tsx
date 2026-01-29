import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import HCaptcha, { type HCaptchaRef } from "@/components/HCaptcha";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

export default function NewDonationScreen() {
  const navigation = useNavigation();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const captchaRef = useRef<HCaptchaRef>(null);

  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(), []);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {}
  }, [navigation]);

  const handleSubmit = () => {
    setError(null);

    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    const amountValue = Number(amount.trim());
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a donation amount greater than zero.");
      return;
    }

    captchaRef.current?.show();
  };

  const handleCaptchaVerify = async (token: string) => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    const amountValue = Number(amount.trim());
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a donation amount greater than zero.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userEmail = sessionData.session?.user?.email || undefined;

      const response = await fetch(`${getWebAppUrl()}/api/stripe/create-donation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: orgId,
          organizationSlug: orgSlug,
          amount: amountValue,
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim() || userEmail,
          purpose: purpose.trim() || undefined,
          mode: "checkout",
          captchaToken: token,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detailSuffix = Array.isArray(data?.details) && data.details.length > 0
          ? ` (${data.details.join(", ")})`
          : "";
        throw new Error(`${data?.error || "Unable to start Stripe Checkout."}${detailSuffix}`);
      }

      if (data?.url) {
        await Linking.openURL(data.url as string);
        return;
      }

      setError("Donation intent created. Complete payment in the browser.");
    } catch (e) {
      setError((e as Error).message || "Unable to start donation checkout.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Record Donation</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <HCaptcha
            ref={captchaRef}
            onVerify={handleCaptchaVerify}
            onError={(message) => setError(message)}
            onExpire={() => setError("Captcha expired. Please try again.")}
            onCancel={() => setError("Captcha was canceled.")}
          />

          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Make a Donation</Text>
            <Text style={styles.formSubtitle}>Support the team with a contribution</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Amount (USD)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="50"
              placeholderTextColor={NEUTRAL.placeholder}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Donor name</Text>
            <TextInput
              value={donorName}
              onChangeText={setDonorName}
              placeholder="Jane Doe"
              placeholderTextColor={NEUTRAL.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Donor email</Text>
            <TextInput
              value={donorEmail}
              onChangeText={setDonorEmail}
              placeholder="donor@example.com"
              placeholderTextColor={NEUTRAL.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Purpose (optional)</Text>
            <TextInput
              value={purpose}
              onChangeText={setPurpose}
              placeholder="General support"
              placeholderTextColor={NEUTRAL.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              isSaving && styles.buttonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue to Stripe</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    headerGradient: {
      // Gradient fills this area
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 8,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.2)",
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleMedium,
      color: APP_CHROME.headerTitle,
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
    formHeader: {
      gap: SPACING.xs,
    },
    formTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
    },
    formSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
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
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      backgroundColor: NEUTRAL.surface,
    },
    textArea: {
      minHeight: 100,
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
}
