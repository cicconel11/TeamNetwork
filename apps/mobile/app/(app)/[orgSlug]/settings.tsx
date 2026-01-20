import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { StripeWebView } from "@/components/StripeWebView";
import { captureException } from "@/lib/analytics";
import {
  ChevronRight,
  CreditCard,
  User,
  Info,
  ExternalLink,
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

function formatStatus(status: string): { label: string; color: string } {
  switch (status) {
    case "active":
      return { label: "Active", color: "#10b981" };
    case "trialing":
      return { label: "Trial", color: "#3b82f6" };
    case "past_due":
      return { label: "Past Due", color: "#f59e0b" };
    case "canceled":
      return { label: "Canceled", color: "#ef4444" };
    default:
      return { label: status, color: "#6b7280" };
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const { orgSlug, orgId } = useOrg();
  const { user } = useAuth();
  const { subscription, loading: subLoading, error: subError, refetch } = useSubscription(orgId);

  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

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

  const statusInfo = subscription ? formatStatus(subscription.status) : null;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563eb"
          />
        }
      >
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <User size={20} color="#666" />
                <Text style={styles.menuItemLabel}>Edit Profile</Text>
              </View>
              <ChevronRight size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Billing Section - Admin Only */}
        {isAdmin && !roleLoading && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing</Text>
            <View style={styles.card}>
              {subLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#2563eb" />
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
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <CreditCard size={18} color="#ffffff" />
                        <Text style={styles.billingButtonText}>Manage Billing</Text>
                        <ExternalLink size={16} color="#ffffff" />
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
                <Info size={20} color="#666" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
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
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#ffffff",
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
    borderBottomColor: "#f5f5f5",
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuItemLabel: {
    fontSize: 16,
    color: "#1a1a1a",
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  errorContainer: {
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    color: "#dc2626",
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  retryButtonText: {
    color: "#ffffff",
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
    color: "#666",
  },
  subscriptionValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
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
    backgroundColor: "#2563eb",
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  billingButtonText: {
    color: "#ffffff",
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
    color: "#1a1a1a",
    textAlign: "center",
  },
  noSubscriptionHint: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  versionText: {
    fontSize: 14,
    color: "#666",
  },
});
