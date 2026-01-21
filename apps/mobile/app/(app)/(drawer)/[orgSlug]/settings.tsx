import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { StripeWebView } from "@/components/StripeWebView";
import { captureException } from "@/lib/analytics";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";
import {
  ChevronRight,
  CreditCard,
  User,
  Info,
  ExternalLink,
  Bell,
} from "lucide-react-native";
import Constants from "expo-constants";

const WEB_API_URL = process.env.EXPO_PUBLIC_WEB_URL || "https://www.myteamnetwork.com";

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBucket(bucket: string): string {
  if (bucket === "none") return "Base Plan";
  return `Alumni ${bucket}`;
}

function formatStatus(status: string, colors: ThemeColors): { label: string; color: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: colors.success };
    case "trialing":
      return { label: "Trial", color: colors.primary };
    case "past_due":
      return { label: "Past Due", color: colors.warning };
    case "canceled":
      return { label: "Canceled", color: colors.error };
    default:
      return { label: status, color: colors.mutedForeground };
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const { subscription, loading: subLoading, error: subError, refetch } = useSubscription(orgId);
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [prefLoading, setPrefLoading] = useState(true);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);

  // Fetch user role
  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgId || !user) {
        setRoleLoading(false);
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .single();

        if (roleData && isMounted) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);
        }
      } catch (e) {
        console.error("Failed to fetch role:", e);
        captureException(e as Error, { screen: "Settings", context: "fetchRole", orgId });
      } finally {
        if (isMounted) {
          setRoleLoading(false);
        }
      }
    }

    fetchRole();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  const loadNotificationPreferences = useCallback(async () => {
    if (!orgId || !user) {
      setPrefLoading(false);
      return;
    }

    setPrefLoading(true);
    setPrefError(null);

    try {
      const { data: pref, error } = await supabase
        .from("notification_preferences")
        .select("id, push_enabled")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      setPrefId(pref?.id ?? null);
      setPushEnabled(pref?.push_enabled ?? true);
    } catch (e) {
      console.error("Failed to load notification preferences:", e);
      captureException(e as Error, { screen: "Settings", context: "loadNotificationPreferences", orgId });
      setPrefError((e as Error).message || "Failed to load preferences");
    } finally {
      setPrefLoading(false);
    }
  }, [orgId, user]);

  useEffect(() => {
    loadNotificationPreferences();
  }, [loadNotificationPreferences]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), loadNotificationPreferences()]);
    setRefreshing(false);
  }, [refetch, loadNotificationPreferences]);

  const handlePushToggle = async (nextValue: boolean) => {
    if (!orgId || !user) {
      Alert.alert("Error", "Not authenticated");
      return;
    }

    const previousValue = pushEnabled;
    setPushEnabled(nextValue);
    setPrefSaving(true);
    setPrefError(null);

    try {
      if (prefId) {
        const { error } = await supabase
          .from("notification_preferences")
          .update({ push_enabled: nextValue })
          .eq("id", prefId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("notification_preferences")
          .insert({
            organization_id: orgId,
            user_id: user.id,
            push_enabled: nextValue,
            email_enabled: true,
            email_address: user.email ?? null,
            phone_number: null,
            sms_enabled: false,
          })
          .select("id")
          .maybeSingle();

        if (error) throw error;
        setPrefId(data?.id ?? null);
      }
    } catch (e) {
      console.error("Failed to update notification preferences:", e);
      captureException(e as Error, { screen: "Settings", context: "updateNotificationPreferences", orgId });
      setPrefError((e as Error).message || "Failed to update preferences");
      setPushEnabled(previousValue);
    } finally {
      setPrefSaving(false);
    }
  };

  const handleManageBilling = async () => {
    if (!orgId) return;

    setBillingLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) {
        Alert.alert("Error", "Not authenticated");
        return;
      }

      const response = await fetch(`${WEB_API_URL}/api/stripe/billing-portal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Content-Type": "application/json",
        },
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
      console.error("Billing portal error:", e);
      Alert.alert("Error", "Failed to open billing portal");
      captureException(e as Error, { screen: "Settings", context: "billingPortal", orgId });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCloseBillingPortal = () => {
    setBillingPortalUrl(null);
    // Refresh subscription data after closing billing portal
    refetch();
  };

  const statusInfo = subscription ? formatStatus(subscription.status, colors) : null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <User size={20} color={colors.muted} />
                <Text style={styles.menuItemLabel}>Edit Profile</Text>
              </View>
              <ChevronRight size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Bell size={20} color={colors.muted} />
                <View style={styles.menuItemText}>
                  <Text style={styles.menuItemLabel}>Push Notifications</Text>
                  <Text style={styles.menuItemHint}>
                    Announcements and events for this organization
                  </Text>
                </View>
              </View>
              {prefLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={pushEnabled}
                  onValueChange={handlePushToggle}
                  disabled={prefSaving}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={pushEnabled ? colors.primary : colors.card}
                />
              )}
            </View>
            {prefError ? (
              <View style={styles.preferenceError}>
                <Text style={styles.preferenceErrorText} selectable>
                  {prefError}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Billing Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing</Text>
            <View style={styles.card}>
              {subLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.loadingText}>Loading subscription...</Text>
                </View>
              ) : subError ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{subError}</Text>
                  <TouchableOpacity onPress={handleRefresh} style={styles.retryButton}>
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : subscription ? (
                <>
                  {/* Subscription Status Card */}
                  <View style={styles.subscriptionCard}>
                    <View style={styles.subscriptionRow}>
                      <Text style={styles.subscriptionLabel}>Current Plan</Text>
                      <Text style={styles.subscriptionValue}>
                        {formatBucket(subscription.bucket)}
                      </Text>
                    </View>
                    <View style={styles.subscriptionRow}>
                      <Text style={styles.subscriptionLabel}>Status</Text>
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: statusInfo?.color + "20" },
                        ]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: statusInfo?.color },
                          ]}
                        />
                        <Text
                          style={[styles.statusText, { color: statusInfo?.color }]}
                        >
                          {statusInfo?.label}
                        </Text>
                      </View>
                    </View>
                    {subscription.currentPeriodEnd && (
                      <View style={styles.subscriptionRow}>
                        <Text style={styles.subscriptionLabel}>Next Billing</Text>
                        <Text style={styles.subscriptionValue}>
                          {formatDate(subscription.currentPeriodEnd)}
                        </Text>
                      </View>
                    )}
                    {subscription.alumniLimit !== null && (
                      <View style={styles.subscriptionRow}>
                        <Text style={styles.subscriptionLabel}>Alumni Usage</Text>
                        <Text style={styles.subscriptionValue}>
                          {subscription.alumniCount} / {subscription.alumniLimit}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Manage Billing Button */}
                  <TouchableOpacity
                    style={styles.billingButton}
                    onPress={handleManageBilling}
                    disabled={billingLoading}
                    activeOpacity={0.7}
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
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.noSubscription}>
                  <Text style={styles.noSubscriptionText}>
                    No active subscription found.
                  </Text>
                  <Text style={styles.noSubscriptionHint}>
                    Set up billing from the web app to manage your subscription.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <Info size={20} color={colors.muted} />
                <Text style={styles.menuItemLabel}>App Version</Text>
              </View>
              <Text style={styles.versionText}>
                {Constants.expoConfig?.version || "1.0.0"}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Stripe Billing Portal WebView */}
      {billingPortalUrl && (
        <StripeWebView
          visible={!!billingPortalUrl}
          url={billingPortalUrl}
          onClose={handleCloseBillingPortal}
          title="Billing Portal"
          successUrls={[`/${orgSlug}`]}
          cancelUrls={[`/${orgSlug}`]}
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderCurve: "continuous",
      overflow: "hidden",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    menuItemLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    menuItemText: {
      flex: 1,
      gap: 2,
    },
    menuItemLabel: {
      fontSize: 16,
      color: colors.foreground,
    },
    menuItemHint: {
      fontSize: 12,
      color: colors.mutedForeground,
    },
    loadingContainer: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    loadingText: {
      fontSize: 14,
      color: colors.muted,
    },
    errorContainer: {
      padding: 16,
      alignItems: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      textAlign: "center",
    },
    preferenceError: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    preferenceErrorText: {
      fontSize: 13,
      color: colors.error,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    retryButtonText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontWeight: "600",
    },
    subscriptionCard: {
      padding: 16,
      gap: 12,
    },
    subscriptionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    subscriptionLabel: {
      fontSize: 14,
      color: colors.muted,
    },
    subscriptionValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.foreground,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
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
    statusText: {
      fontSize: 13,
      fontWeight: "600",
    },
    billingButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      marginHorizontal: 16,
      marginBottom: 16,
      paddingVertical: 12,
      borderRadius: 8,
      gap: 8,
    },
    billingButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: "600",
    },
    noSubscription: {
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    noSubscriptionText: {
      fontSize: 15,
      fontWeight: "500",
      color: colors.foreground,
      textAlign: "center",
    },
    noSubscriptionHint: {
      fontSize: 14,
      color: colors.muted,
      textAlign: "center",
    },
    versionText: {
      fontSize: 14,
      color: colors.muted,
    },
  });
