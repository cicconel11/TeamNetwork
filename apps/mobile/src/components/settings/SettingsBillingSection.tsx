import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  Linking,
} from "react-native";
import { CreditCard, ChevronDown, ExternalLink } from "lucide-react-native";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { getWebAppUrl } from "@/lib/web-api";
import type { AlumniBucket } from "@teammeet/types";
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
  orgSlug: string;
  isAdmin: boolean;
  subscription: SubscriptionData | null;
  subLoading: boolean;
  subError: string | null;
  refetchSubscription: () => void;
}

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
  orgSlug,
  isAdmin,
  subscription,
  subLoading,
  subError,
  refetchSubscription,
}: Props) {
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [expanded, setExpanded] = useState(true);

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
    webHint: {
      fontSize: fontSize.sm,
      color: n.muted,
      lineHeight: 20,
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
  }));

  if (!isAdmin) return null;

  const statusInfo = subscription ? formatStatus(subscription.status, colors) : null;

  const handleOpenBillingInWeb = async () => {
    try {
      await Linking.openURL(`${getWebAppUrl()}/${orgSlug}/settings/billing`);
    } catch {
      Alert.alert("Error", "Unable to open billing on the web.");
    }
  };

  const billingButtonLabel = subscription ? "Manage Billing on Web" : "Set Up Billing on Web";

  const billingHint = subscription
    ? "To change plans, manage payment methods, view invoices, or cancel your subscription, continue in the web billing portal."
    : "Billing setup and checkout are handled on the web.";

  return (
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

              <Text style={styles.webHint}>{billingHint}</Text>

              <Pressable style={styles.billingButton} onPress={handleOpenBillingInWeb}>
                <>
                  <CreditCard size={18} color={colors.primaryForeground} />
                  <Text style={styles.billingButtonText}>{billingButtonLabel}</Text>
                  <ExternalLink size={16} color={colors.primaryForeground} />
                </>
              </Pressable>
            </>
          ) : (
            <View style={styles.noSubscription}>
              <Text style={styles.noSubscriptionText}>No active subscription found.</Text>
              <Text style={styles.noSubscriptionHint}>{billingHint}</Text>
              <Pressable style={styles.billingButton} onPress={handleOpenBillingInWeb}>
                <>
                  <CreditCard size={18} color={colors.primaryForeground} />
                  <Text style={styles.billingButtonText}>{billingButtonLabel}</Text>
                  <ExternalLink size={16} color={colors.primaryForeground} />
                </>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
