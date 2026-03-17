import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
} from "react-native";
import { CreditCard, ChevronDown, Check, ExternalLink } from "lucide-react-native";
import { StripeWebView } from "@/components/StripeWebView";
import { fetchWithAuth } from "@/lib/web-api";
import { captureException } from "@/lib/analytics";
import type { AlumniBucket } from "@teammeet/types";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, formatDate, formatBucket, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface SubscriptionData {
  status: string;
  bucket: AlumniBucket;
  currentPeriodEnd: string | null;
  alumniCount: number;
  alumniLimit: number | null;
}

interface Props {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  subscription: SubscriptionData | null;
  subLoading: boolean;
  subError: string | null;
  refetchSubscription: () => void;
}

const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

const BUCKET_OPTIONS: { value: AlumniBucket; label: string }[] = [
  { value: "0-250", label: "0\u2013250 alumni" },
  { value: "251-500", label: "251\u2013500 alumni" },
  { value: "501-1000", label: "501\u20131,000 alumni" },
  { value: "1001-2500", label: "1,001\u20132,500 alumni" },
  { value: "2500-5000", label: "2,500\u20135,000 alumni" },
  { value: "5000+", label: "5,000+ (contact us)" },
];

function formatStatus(
  status: string,
  colors: { success: string; primary: string; warning: string; error: string; mutedForeground: string }
): { label: string; color: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: colors.success };
    case "trialing":
      return { label: "Trial", color: colors.primary };
    case "past_due":
      return { label: "Past Due", color: colors.warning };
    case "canceled":
    case "canceling":
      return {
        label: status === "canceling" ? "Canceling" : "Canceled",
        color: colors.error,
      };
    default:
      return { label: status, color: colors.mutedForeground };
  }
}

export function SettingsBillingSection({
  orgId,
  orgSlug,
  isAdmin,
  subscription,
  subLoading,
  subError,
  refetchSubscription,
}: Props) {
  const { neutral, semantic } = useAppColorScheme();
  const colors = buildSettingsColors(neutral, semantic);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<AlumniBucket>("0-250");
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">("month");
  const [planUpdating, setPlanUpdating] = useState(false);
  const [showBucketPicker, setShowBucketPicker] = useState(false);

  useEffect(() => {
    if (subscription?.bucket && subscription.bucket !== selectedBucket) {
      setSelectedBucket(subscription.bucket);
    }
  }, [subscription?.bucket]);

  const styles = useThemedStyles((n, s) => ({
    loadingText: {
      fontSize: fontSize.sm,
      color: n.muted,
    },
    errorContainer: {
      padding: 16,
      alignItems: "center" as const,
      gap: 12,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: s.error,
      textAlign: "center" as const,
    },
    retryButton: {
      backgroundColor: s.success,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    fieldGroup: {
      marginBottom: 16,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      marginBottom: 8,
    },
    button: {
      backgroundColor: s.success,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: "#ffffff",
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    subscriptionCard: {
      gap: 12,
    },
    subscriptionRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
    },
    subscriptionLabel: {
      fontSize: fontSize.sm,
      color: n.muted,
    },
    subscriptionValue: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: n.foreground,
    },
    statusBadgeLarge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusTextLarge: {
      fontSize: 13,
      fontWeight: fontWeight.semibold,
    },
    pickerButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      backgroundColor: n.background,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginBottom: 12,
    },
    pickerButtonText: {
      fontSize: fontSize.base,
      color: n.foreground,
    },
    intervalRow: {
      flexDirection: "row" as const,
      gap: 8,
      marginBottom: 12,
    },
    intervalButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: n.border,
      alignItems: "center" as const,
    },
    intervalButtonActive: {
      borderColor: s.success,
      backgroundColor: s.success + "10",
    },
    intervalButtonText: {
      fontSize: fontSize.sm,
      color: n.muted,
    },
    intervalButtonTextActive: {
      color: s.success,
      fontWeight: fontWeight.semibold,
    },
    billingButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: s.success,
      paddingVertical: 12,
      borderRadius: 8,
      gap: 8,
    },
    billingButtonText: {
      color: "#ffffff",
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    noSubscription: {
      padding: 24,
      alignItems: "center" as const,
      gap: 8,
    },
    noSubscriptionText: {
      fontSize: 15,
      fontWeight: fontWeight.medium,
      color: n.foreground,
      textAlign: "center" as const,
    },
    noSubscriptionHint: {
      fontSize: fontSize.sm,
      color: n.muted,
      textAlign: "center" as const,
    },
    pickerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end" as const,
    },
    pickerContent: {
      backgroundColor: n.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    pickerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: n.foreground,
      marginBottom: 16,
      textAlign: "center" as const,
    },
    pickerOption: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    pickerOptionDisabled: {
      opacity: 0.5,
    },
    pickerOptionText: {
      fontSize: fontSize.base,
      color: n.foreground,
    },
    pickerOptionTextDisabled: {
      color: n.muted,
    },
  }));

  if (!isAdmin) return null;

  const statusInfo = subscription ? formatStatus(subscription.status, colors) : null;

  const handleManageBilling = async () => {
    if (!orgId) return;

    setBillingLoading(true);
    try {
      const response = await fetchWithAuth("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.error || "Failed to open billing portal");
        return;
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      }
    } catch (e) {
      Alert.alert("Error", "Failed to open billing portal");
      captureException(e as Error, { screen: "Settings", context: "billingPortal", orgId });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCloseBillingPortal = () => {
    setBillingPortalUrl(null);
    refetchSubscription();
  };

  const handleUpdatePlan = async () => {
    if (!orgId) return;

    const targetLimit = ALUMNI_LIMITS[selectedBucket];
    if (subscription && targetLimit !== null && subscription.alumniCount > targetLimit) {
      Alert.alert("Error", "You have more alumni than this plan allows. Choose a larger plan.");
      return;
    }

    setPlanUpdating(true);
    try {
      const endpoint = subscription?.status !== "active"
        ? `/api/organizations/${orgId}/start-checkout`
        : `/api/organizations/${orgId}/subscription`;

      const response = await fetchWithAuth(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniBucket: selectedBucket, interval: selectedInterval }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to update subscription");
      }

      if (data.url) {
        setBillingPortalUrl(data.url);
      } else {
        Alert.alert("Success", "Subscription updated.");
        refetchSubscription();
      }
    } catch (e) {
      Alert.alert("Error", (e as Error).message);
    } finally {
      setPlanUpdating(false);
    }
  };

  return (
    <>
      <View style={baseStyles.section}>
        <Pressable
          style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
          onPress={() => setExpanded((prev) => !prev)}
        >
          <View style={baseStyles.sectionHeaderLeft}>
            <CreditCard size={20} color={colors.muted} />
            <Text style={baseStyles.sectionTitle}>Billing</Text>
          </View>
          <ChevronDown
            size={20}
            color={colors.mutedForeground}
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        </Pressable>

        {expanded && (
          <View style={baseStyles.card}>
            {subLoading ? (
              <View style={baseStyles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Loading subscription...</Text>
              </View>
            ) : subError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{subError}</Text>
                <Pressable onPress={refetchSubscription} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            ) : subscription ? (
              <>
                <View style={styles.subscriptionCard}>
                  <View style={styles.subscriptionRow}>
                    <Text style={styles.subscriptionLabel}>Current Plan</Text>
                    <Text style={styles.subscriptionValue}>{formatBucket(subscription.bucket)}</Text>
                  </View>
                  <View style={styles.subscriptionRow}>
                    <Text style={styles.subscriptionLabel}>Status</Text>
                    <View style={[styles.statusBadgeLarge, { backgroundColor: statusInfo?.color + "20" }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusInfo?.color }]} />
                      <Text style={[styles.statusTextLarge, { color: statusInfo?.color }]}>
                        {statusInfo?.label}
                      </Text>
                    </View>
                  </View>
                  {subscription.currentPeriodEnd && (
                    <View style={styles.subscriptionRow}>
                      <Text style={styles.subscriptionLabel}>Next Billing</Text>
                      <Text style={styles.subscriptionValue}>{formatDate(subscription.currentPeriodEnd)}</Text>
                    </View>
                  )}
                </View>

                <View style={baseStyles.divider} />

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Change Plan</Text>
                  <Pressable style={styles.pickerButton} onPress={() => setShowBucketPicker(true)}>
                    <Text style={styles.pickerButtonText}>
                      {BUCKET_OPTIONS.find((o) => o.value === selectedBucket)?.label || selectedBucket}
                    </Text>
                    <ChevronDown size={16} color={colors.mutedForeground} />
                  </Pressable>

                  <View style={styles.intervalRow}>
                    <Pressable
                      style={[styles.intervalButton, selectedInterval === "month" && styles.intervalButtonActive]}
                      onPress={() => setSelectedInterval("month")}
                    >
                      <Text
                        style={[
                          styles.intervalButtonText,
                          selectedInterval === "month" && styles.intervalButtonTextActive,
                        ]}
                      >
                        Monthly
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.intervalButton, selectedInterval === "year" && styles.intervalButtonActive]}
                      onPress={() => setSelectedInterval("year")}
                    >
                      <Text
                        style={[
                          styles.intervalButtonText,
                          selectedInterval === "year" && styles.intervalButtonTextActive,
                        ]}
                      >
                        Yearly (save ~17%)
                      </Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={[
                      styles.button,
                      (planUpdating || selectedBucket === subscription.bucket) && styles.buttonDisabled,
                    ]}
                    onPress={handleUpdatePlan}
                    disabled={planUpdating || selectedBucket === subscription.bucket}
                  >
                    {planUpdating ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Text style={styles.buttonText}>Update Plan</Text>
                    )}
                  </Pressable>
                </View>

                <View style={baseStyles.divider} />

                <Pressable
                  style={styles.billingButton}
                  onPress={handleManageBilling}
                  disabled={billingLoading}
                >
                  {billingLoading ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <>
                      <CreditCard size={18} color={colors.primaryForeground} />
                      <Text style={styles.billingButtonText}>Manage Billing</Text>
                      <ExternalLink size={16} color={colors.primaryForeground} />
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <View style={styles.noSubscription}>
                <Text style={styles.noSubscriptionText}>No active subscription found.</Text>
                <Text style={styles.noSubscriptionHint}>Set up billing from the web app.</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {billingPortalUrl && (
        <StripeWebView
          visible={true}
          url={billingPortalUrl}
          onClose={handleCloseBillingPortal}
          title="Billing Portal"
          successUrls={[`/${orgSlug}`]}
          cancelUrls={[`/${orgSlug}`]}
        />
      )}

      <Modal visible={showBucketPicker} transparent animationType="slide">
        <Pressable style={styles.pickerOverlay} onPress={() => setShowBucketPicker(false)}>
          <View style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>Select Alumni Plan</Text>
            {BUCKET_OPTIONS.map((option) => {
              const limit = ALUMNI_LIMITS[option.value];
              const disabled = subscription && limit !== null && subscription.alumniCount > limit;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.pickerOption, disabled && styles.pickerOptionDisabled]}
                  onPress={() => {
                    if (!disabled) {
                      setSelectedBucket(option.value);
                      setShowBucketPicker(false);
                    }
                  }}
                  disabled={disabled ?? false}
                >
                  <Text style={[styles.pickerOptionText, disabled && styles.pickerOptionTextDisabled]}>
                    {option.label}
                  </Text>
                  {selectedBucket === option.value && <Check size={18} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
