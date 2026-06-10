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
import { useNavigation, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import Turnstile, { type TurnstileRef } from "@/components/Turnstile";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { openHttpsUrl } from "@/lib/url-safety";
import { track } from "@/lib/analytics";
import { useDonationPaymentSheet } from "@/hooks/useDonationPaymentSheet";
import { AddToWalletButton } from "@/components/wallet/AddToWalletButton";

function donationAmountBucket(amount: number) {
  if (amount < 10) return "<10";
  if (amount <= 25) return "10-25";
  if (amount <= 50) return "26-50";
  if (amount <= 100) return "51-100";
  if (amount <= 250) return "101-250";
  return "250+";
}

export default function NewDonationScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const { orgId, orgSlug } = useOrg();
  const captchaRef = useRef<TurnstileRef>(null);
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      // Gradient fills this area
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      overflow: "hidden" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleMedium,
      color: APP_CHROME.headerTitle,
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
      color: n.foreground,
    },
    formSubtitle: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
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
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    textArea: {
      minHeight: 100,
    },
    primaryButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
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
  }));

  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeededAttemptId, setSucceededAttemptId] = useState<string | null>(null);
  const [receiptState, setReceiptState] = useState<
    | { kind: "idle" }
    | { kind: "polling" }
    | { kind: "ready" }
    | { kind: "timeout" }
  >({ kind: "idle" });
  const { start: startPaymentSheet, isProcessing: paymentSheetBusy } =
    useDonationPaymentSheet();
  const isIOS = Platform.OS === "ios";

  // Webhook lag: organization_donations is created by the Stripe Connect
  // webhook asynchronously after Payment Sheet completes. Poll the receipt
  // route until it returns 200, with bounded retry. The Wallet button shows
  // once ready; the Done button is always available so the user can leave.
  // pollEpoch advances on manual retry to re-trigger the effect.
  const [pollEpoch, setPollEpoch] = useState(0);
  useEffect(() => {
    if (!succeededAttemptId) return;
    let cancelled = false;
    setReceiptState({ kind: "polling" });
    (async () => {
      const maxAttempts = 10;
      const intervalMs = 3000;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) return;
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          const res = await fetch(
            `${getWebAppUrl()}/api/wallet/receipt/by-payment-attempt/${succeededAttemptId}`,
            {
              method: "GET",
              headers: accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : undefined,
            },
          );
          if (cancelled) return;
          if (res.ok) {
            setReceiptState({ kind: "ready" });
            return;
          }
          if (res.status !== 409) {
            setReceiptState({ kind: "timeout" });
            return;
          }
        } catch {
          // Network blip — keep polling.
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (!cancelled) setReceiptState({ kind: "timeout" });
    })();
    return () => {
      cancelled = true;
    };
  }, [succeededAttemptId, pollEpoch]);

  const handleBack = useCallback(() => {
    if ((navigation as any).canGoBack && (navigation as any).canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/${orgSlug}/donations`);
    }
  }, [navigation, router, orgSlug]);

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

    if (isIOS) {
      const amountBucket = donationAmountBucket(amountValue);
      track("donation_checkout_start", {
        org_slug: orgSlug,
        amount_bucket: amountBucket,
        has_purpose: !!purpose.trim(),
        channel: "payment_sheet",
      });

      const result = await startPaymentSheet({
        organizationId: orgId,
        organizationSlug: orgSlug,
        amount: amountValue,
        donorName: donorName.trim() || undefined,
        donorEmail: donorEmail.trim() || undefined,
        purpose: purpose.trim() || undefined,
        captchaToken: token,
      });

      if (result.status === "completed") {
        track("donation_checkout_result", {
          org_slug: orgSlug,
          amount_bucket: amountBucket,
          channel: "payment_sheet",
          result: "success",
        });
        setSucceededAttemptId(result.paymentAttemptId);
        return;
      }
      if (result.status === "canceled") {
        track("donation_checkout_result", {
          org_slug: orgSlug,
          amount_bucket: amountBucket,
          channel: "payment_sheet",
          result: "cancel",
        });
        return;
      }
      if (result.status === "ineligible_ios") {
        track("donation_checkout_result", {
          org_slug: orgSlug,
          amount_bucket: amountBucket,
          channel: "payment_sheet",
          result: "fail",
          error_code: "org_not_eligible_ios",
        });
        setError(
          "Donations for this organization are only available on the web. Please open the web app to contribute.",
        );
        return;
      }
      track("donation_checkout_result", {
        org_slug: orgSlug,
        amount_bucket: amountBucket,
        channel: "payment_sheet",
        result: "fail",
        error_code: "payment_sheet_error",
      });
      setError(result.message);
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
        track("donation_checkout_start", {
          org_slug: orgSlug,
          amount_bucket: donationAmountBucket(amountValue),
          has_purpose: !!(purpose.trim()),
          channel: "checkout",
        });
        if (!(await openHttpsUrl(data.url as string))) {
          throw new Error("Checkout URL was invalid");
        }
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
            <Pressable onPress={handleBack} style={styles.orgLogoButton} hitSlop={8}>
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
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
          <Turnstile
            ref={captchaRef}
            onVerify={handleCaptchaVerify}
            onError={(message) => setError(message)}
            onCancel={() => setError("Captcha was canceled.")}
          />

          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>
              {succeededAttemptId ? "Thank you!" : "Make a Donation"}
            </Text>
            <Text style={styles.formSubtitle}>
              {succeededAttemptId
                ? "Your donation was received. Save a receipt to Apple Wallet for your records."
                : "Support the team with a contribution"}
            </Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {succeededAttemptId && (
            <>
              {receiptState.kind === "polling" && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.sm,
                    padding: SPACING.md,
                  }}
                >
                  <ActivityIndicator color={semantic.success} />
                  <Text style={styles.formSubtitle}>
                    We&apos;re finalizing your receipt…
                  </Text>
                </View>
              )}
              {receiptState.kind === "ready" && (
                <AddToWalletButton
                  apiPath={`/api/wallet/receipt/by-payment-attempt/${succeededAttemptId}`}
                  fileBaseName={`donation-${succeededAttemptId}`}
                  label="Save receipt to Apple Wallet"
                />
              )}
              {receiptState.kind === "timeout" && (
                <Pressable
                  onPress={() => setPollEpoch((n) => n + 1)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Try again</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => router.replace(`/(app)/${orgSlug}/donations`)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>Done</Text>
              </Pressable>
            </>
          )}

          {!succeededAttemptId && (
          <>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Amount (USD)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="50"
              placeholderTextColor={neutral.placeholder}
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
              placeholderTextColor={neutral.placeholder}
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Donor email</Text>
            <TextInput
              value={donorEmail}
              onChangeText={setDonorEmail}
              placeholder="donor@example.com"
              placeholderTextColor={neutral.placeholder}
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
              placeholderTextColor={neutral.placeholder}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.textArea]}
            />
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={isSaving || paymentSheetBusy}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              (isSaving || paymentSheetBusy) && styles.buttonDisabled,
            ]}
          >
            {isSaving || paymentSheetBusy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isIOS ? "Donate" : "Continue to Stripe"}
              </Text>
            )}
          </Pressable>
          </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
