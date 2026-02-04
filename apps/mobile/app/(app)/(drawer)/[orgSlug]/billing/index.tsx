import React, { useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import { useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useSubscription } from "@/hooks/useSubscription";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import {
  ALUMNI_BUCKET_LABELS,
  ALUMNI_LIMITS,
  getTotalPrice,
  formatPrice,
  normalizeBucket,
} from "@teammeet/core";
import type { AlumniBucket, SubscriptionInterval } from "@teammeet/types";
import {
  CreditCard,
  ExternalLink,
  AlertCircle,
  Users,
  TrendingUp,
  Calendar,
  Shield,
} from "lucide-react-native";

const BILLING_COLORS = {
  background: NEUTRAL.background,
  surface: NEUTRAL.surface,
  foreground: NEUTRAL.foreground,
  secondary: NEUTRAL.secondary,
  muted: NEUTRAL.muted,
  border: NEUTRAL.border,
  primary: SEMANTIC.success,
  primaryLight: SEMANTIC.successLight,
  warning: SEMANTIC.warning,
  warningLight: SEMANTIC.warningLight,
  error: SEMANTIC.error,
  errorLight: SEMANTIC.errorLight,
  info: SEMANTIC.info,
  infoLight: SEMANTIC.infoLight,
};

function formatStatus(status: string): { label: string; color: string; bgColor: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: BILLING_COLORS.primary, bgColor: BILLING_COLORS.primaryLight };
    case "trialing":
      return { label: "Trial", color: BILLING_COLORS.info, bgColor: BILLING_COLORS.infoLight };
    case "past_due":
      return { label: "Past Due", color: BILLING_COLORS.warning, bgColor: BILLING_COLORS.warningLight };
    case "canceled":
    case "canceling":
      return {
        label: status === "canceling" ? "Canceling" : "Canceled",
        color: BILLING_COLORS.error,
        bgColor: BILLING_COLORS.errorLight,
      };
    default:
      return { label: status, color: BILLING_COLORS.muted, bgColor: NEUTRAL.divider };
  }
}

function formatBucketLabel(bucket: AlumniBucket): string {
  return ALUMNI_BUCKET_LABELS[bucket] || bucket;
}

export default function BillingScreen() {
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const {
    subscription,
    loading: subLoading,
    error: subError,
    refetch: refetchSubscription,
  } = useSubscription(orgId);
  const styles = useMemo(() => createStyles(), []);

  const [refreshing, setRefreshing] = React.useState(false);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchSubscription();
    setRefreshing(false);
  }, [refetchSubscription]);

  const handleManageBillingInWeb = useCallback(() => {
    const url = `https://www.myteamnetwork.com/${orgSlug}/settings/billing`;
    Linking.openURL(url);
  }, [orgSlug]);

  const statusInfo = subscription ? formatStatus(subscription.status) : null;
  const normalizedBucket = subscription ? normalizeBucket(subscription.bucket) : "none";
  const alumniLimit = ALUMNI_LIMITS[normalizedBucket];
  const usagePercent =
    subscription && alumniLimit !== null && alumniLimit > 0
      ? Math.min((subscription.alumniCount / alumniLimit) * 100, 100)
      : 0;

  // Calculate current price (estimate based on bucket)
  const estimatedPrice =
    subscription && normalizedBucket !== "none"
      ? getTotalPrice("month" as SubscriptionInterval, normalizedBucket)
      : null;

  // Admin-only access check
  if (!roleLoading && !isAdmin) {
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
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Billing</Text>
                <Text style={styles.headerMeta}>{orgName}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.contentSheet}>
          <View style={styles.accessDenied}>
            <Shield size={48} color={BILLING_COLORS.muted} />
            <Text style={styles.accessDeniedTitle}>Admin Access Required</Text>
            <Text style={styles.accessDeniedText}>
              Only organization admins can view billing information.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Billing</Text>
              <Text style={styles.headerMeta}>{orgName}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={BILLING_COLORS.primary}
            />
          }
        >
          {subLoading || roleLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={BILLING_COLORS.primary} />
              <Text style={styles.loadingText}>Loading subscription...</Text>
            </View>
          ) : subError ? (
            <View style={styles.errorContainer}>
              <AlertCircle size={40} color={BILLING_COLORS.error} />
              <Text style={styles.errorTitle}>Unable to Load Billing</Text>
              <Text style={styles.errorText}>{subError}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.8 }]}
                onPress={handleRefresh}
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </Pressable>
            </View>
          ) : subscription ? (
            <>
              {/* Subscription Status Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <CreditCard size={20} color={BILLING_COLORS.primary} />
                  <Text style={styles.cardTitle}>Subscription</Text>
                  {statusInfo && (
                    <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
                      <Text style={[styles.statusText, { color: statusInfo.color }]}>
                        {statusInfo.label}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.tierRow}>
                  <Text style={styles.tierLabel}>Current Plan</Text>
                  <Text style={styles.tierValue}>{formatBucketLabel(normalizedBucket)}</Text>
                </View>

                {estimatedPrice !== null && (
                  <View style={styles.tierRow}>
                    <Text style={styles.tierLabel}>Monthly Cost</Text>
                    <Text style={styles.tierValue}>{formatPrice(estimatedPrice, "month")}</Text>
                  </View>
                )}

                {subscription.currentPeriodEnd && (
                  <View style={styles.tierRow}>
                    <View style={styles.tierLabelRow}>
                      <Calendar size={14} color={BILLING_COLORS.muted} />
                      <Text style={styles.tierLabel}>Next Billing</Text>
                    </View>
                    <Text style={styles.tierValue}>
                      {formatMonthDayYearSafe(subscription.currentPeriodEnd, "N/A")}
                    </Text>
                  </View>
                )}
              </View>

              {/* Alumni Usage Card */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Users size={20} color={BILLING_COLORS.primary} />
                  <Text style={styles.cardTitle}>Alumni Usage</Text>
                </View>

                <View style={styles.usageStats}>
                  <View style={styles.usageStat}>
                    <Text style={styles.usageNumber}>{subscription.alumniCount}</Text>
                    <Text style={styles.usageLabel}>Current</Text>
                  </View>
                  <View style={styles.usageDivider} />
                  <View style={styles.usageStat}>
                    <Text style={styles.usageNumber}>
                      {alumniLimit !== null ? alumniLimit : "Unlimited"}
                    </Text>
                    <Text style={styles.usageLabel}>Limit</Text>
                  </View>
                  <View style={styles.usageDivider} />
                  <View style={styles.usageStat}>
                    <Text style={styles.usageNumber}>
                      {subscription.remaining !== null ? subscription.remaining : "N/A"}
                    </Text>
                    <Text style={styles.usageLabel}>Remaining</Text>
                  </View>
                </View>

                {alumniLimit !== null && alumniLimit > 0 && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${usagePercent}%`,
                            backgroundColor:
                              usagePercent >= 90
                                ? BILLING_COLORS.error
                                : usagePercent >= 75
                                  ? BILLING_COLORS.warning
                                  : BILLING_COLORS.primary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>{Math.round(usagePercent)}% used</Text>
                  </View>
                )}

                {usagePercent >= 90 && (
                  <View style={styles.warningBanner}>
                    <TrendingUp size={16} color={BILLING_COLORS.warning} />
                    <Text style={styles.warningText}>
                      You're approaching your alumni limit. Consider upgrading your plan.
                    </Text>
                  </View>
                )}
              </View>

              {/* Manage Billing Button */}
              <Pressable
                style={({ pressed }) => [styles.manageBillingButton, pressed && { opacity: 0.9 }]}
                onPress={handleManageBillingInWeb}
              >
                <CreditCard size={20} color={NEUTRAL.surface} />
                <Text style={styles.manageBillingText}>Manage Billing in Web</Text>
                <ExternalLink size={18} color={NEUTRAL.surface} />
              </Pressable>

              <Text style={styles.hintText}>
                To change your plan, update payment methods, or view invoices, visit the billing
                settings on the web.
              </Text>
            </>
          ) : (
            <View style={styles.noSubscription}>
              <CreditCard size={48} color={BILLING_COLORS.muted} />
              <Text style={styles.noSubscriptionTitle}>No Active Subscription</Text>
              <Text style={styles.noSubscriptionText}>
                Set up billing from the web to access all features.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.setupButton, pressed && { opacity: 0.9 }]}
                onPress={handleManageBillingInWeb}
              >
                <Text style={styles.setupButtonText}>Set Up Billing</Text>
                <ExternalLink size={16} color={NEUTRAL.surface} />
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BILLING_COLORS.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      flex: 0,
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
      gap: SPACING.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
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
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      gap: SPACING.md,
    },
    loadingContainer: {
      paddingVertical: 60,
      alignItems: "center",
      gap: SPACING.md,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: BILLING_COLORS.muted,
    },
    errorContainer: {
      paddingVertical: 40,
      alignItems: "center",
      gap: SPACING.sm,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: BILLING_COLORS.foreground,
      marginTop: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: BILLING_COLORS.muted,
      textAlign: "center",
    },
    retryButton: {
      marginTop: SPACING.md,
      backgroundColor: BILLING_COLORS.primary,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
    },
    card: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: BILLING_COLORS.border,
      ...SHADOWS.sm,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    cardTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: BILLING_COLORS.foreground,
      flex: 1,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 4,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.full,
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600",
    },
    tierRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: SPACING.xs,
    },
    tierLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    tierLabel: {
      ...TYPOGRAPHY.bodySmall,
      color: BILLING_COLORS.muted,
    },
    tierValue: {
      ...TYPOGRAPHY.bodyMedium,
      fontWeight: "600",
      color: BILLING_COLORS.foreground,
    },
    usageStats: {
      flexDirection: "row",
      justifyContent: "space-around",
      alignItems: "center",
      paddingVertical: SPACING.md,
    },
    usageStat: {
      alignItems: "center",
      flex: 1,
    },
    usageNumber: {
      ...TYPOGRAPHY.headlineMedium,
      color: BILLING_COLORS.foreground,
    },
    usageLabel: {
      ...TYPOGRAPHY.caption,
      color: BILLING_COLORS.muted,
      marginTop: 2,
    },
    usageDivider: {
      width: 1,
      height: 32,
      backgroundColor: BILLING_COLORS.border,
    },
    progressContainer: {
      marginTop: SPACING.sm,
    },
    progressBar: {
      height: 8,
      backgroundColor: NEUTRAL.divider,
      borderRadius: RADIUS.full,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: RADIUS.full,
    },
    progressText: {
      ...TYPOGRAPHY.caption,
      color: BILLING_COLORS.muted,
      textAlign: "right",
      marginTop: 4,
    },
    warningBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: BILLING_COLORS.warningLight,
      padding: SPACING.sm,
      borderRadius: RADIUS.md,
      marginTop: SPACING.md,
      gap: SPACING.sm,
    },
    warningText: {
      ...TYPOGRAPHY.bodySmall,
      color: BILLING_COLORS.warning,
      flex: 1,
    },
    manageBillingButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: BILLING_COLORS.primary,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      gap: SPACING.sm,
    },
    manageBillingText: {
      ...TYPOGRAPHY.labelLarge,
      color: NEUTRAL.surface,
    },
    hintText: {
      ...TYPOGRAPHY.caption,
      color: BILLING_COLORS.muted,
      textAlign: "center",
      paddingHorizontal: SPACING.md,
    },
    noSubscription: {
      paddingVertical: 60,
      alignItems: "center",
      gap: SPACING.sm,
    },
    noSubscriptionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: BILLING_COLORS.foreground,
      marginTop: SPACING.sm,
    },
    noSubscriptionText: {
      ...TYPOGRAPHY.bodySmall,
      color: BILLING_COLORS.muted,
      textAlign: "center",
    },
    setupButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: BILLING_COLORS.primary,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
      marginTop: SPACING.md,
      gap: SPACING.sm,
    },
    setupButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
    },
    accessDenied: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.xl,
      gap: SPACING.sm,
    },
    accessDeniedTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: BILLING_COLORS.foreground,
      marginTop: SPACING.sm,
    },
    accessDeniedText: {
      ...TYPOGRAPHY.bodySmall,
      color: BILLING_COLORS.muted,
      textAlign: "center",
    },
  });
