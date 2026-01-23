import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { DollarSign, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useDonations } from "@/hooks/useDonations";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { OrganizationDonation } from "@teammeet/types";

// Local colors for donations screen
const DONATIONS_COLORS = {
  // Backgrounds
  background: "#ffffff",
  sectionBackground: "#f8fafc",

  // Text
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",

  // Borders & surfaces
  border: "#e2e8f0",
  card: "#ffffff",

  // CTAs
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",

  // Status colors
  success: "#10b981",
  successBg: "#d1fae5",
  error: "#ef4444",
  errorBg: "#fee2e2",
  pending: "#f59e0b",
  pendingBg: "#fef3c7",
};

export default function DonationsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const { donations, stats, loading, error, refetch, refetchIfStale } = useDonations(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

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

  // Admin overflow menu items
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={DONATIONS_COLORS.primaryCTA} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/donations`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug]);

  // Refetch on screen focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await refetch();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch]);

  const handleMakeDonation = useCallback(() => {
    router.push(`/(app)/${orgSlug}/donations/new`);
  }, [router, orgSlug]);

  // Calculate stats
  const totalAmount = (stats?.total_amount_cents ?? 0) / 100;
  const donationCount = stats?.donation_count ?? donations.length;
  const avgDonation = donationCount > 0 ? totalAmount / donationCount : 0;

  // Calculate purpose totals
  const purposeTotals = useMemo(() => {
    return donations.reduce<Record<string, number>>((acc, donation) => {
      const label = donation.purpose || "General support";
      acc[label] = (acc[label] || 0) + (donation.amount_cents || 0);
      return acc;
    }, {});
  }, [donations]);

  const sortedPurposes = useMemo(() => {
    return Object.entries(purposeTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5); // Top 5 purposes
  }, [purposeTotals]);

  // Format currency
  const formatCurrency = (cents: number) => {
    return (cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "succeeded":
        return { bg: DONATIONS_COLORS.successBg, text: DONATIONS_COLORS.success };
      case "failed":
        return { bg: DONATIONS_COLORS.errorBg, text: DONATIONS_COLORS.error };
      default:
        return { bg: DONATIONS_COLORS.pendingBg, text: DONATIONS_COLORS.pending };
    }
  };

  const renderDonationItem = ({ item }: { item: OrganizationDonation }) => {
    const statusStyle = getStatusStyle(item.status);
    return (
      <View style={styles.donationCard}>
        <View style={styles.donationHeader}>
          <View style={styles.donorInfo}>
            <Text style={styles.donorName} numberOfLines={1}>
              {item.donor_name || "Anonymous"}
            </Text>
            {item.donor_email && (
              <Text style={styles.donorEmail} numberOfLines={1}>
                {item.donor_email}
              </Text>
            )}
          </View>
          <Text style={styles.donationAmount}>${formatCurrency(item.amount_cents)}</Text>
        </View>
        <View style={styles.donationFooter}>
          <Text style={styles.donationPurpose} numberOfLines={1}>
            {item.purpose || "General support"}
          </Text>
          <View style={styles.donationMeta}>
            <Text style={styles.donationDate}>{formatDate(item.created_at)}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.statusText, { color: statusStyle.text }]}>
                {item.status}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContent}>
      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Raised</Text>
          <Text style={styles.statValue}>${formatCurrency(totalAmount * 100)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Contributions</Text>
          <Text style={styles.statValue}>{donationCount}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Average Gift</Text>
          <Text style={styles.statValue}>${formatCurrency(avgDonation * 100)}</Text>
        </View>
      </View>

      {/* Make a Donation Button */}
      <TouchableOpacity style={styles.donateButton} onPress={handleMakeDonation}>
        <Plus size={20} color={DONATIONS_COLORS.primaryCTAText} />
        <Text style={styles.donateButtonText}>Make a Donation</Text>
      </TouchableOpacity>

      {/* Purpose Breakdown */}
      {sortedPurposes.length > 0 && (
        <View style={styles.purposeSection}>
          <Text style={styles.sectionTitle}>By Purpose</Text>
          <View style={styles.purposeList}>
            {sortedPurposes.map(([purpose, cents]) => (
              <View key={purpose} style={styles.purposeRow}>
                <Text style={styles.purposeLabel} numberOfLines={1}>
                  {purpose}
                </Text>
                <Text style={styles.purposeAmount}>${formatCurrency(cents)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Recent Donations Header */}
      <Text style={styles.sectionTitle}>Recent Donations</Text>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <DollarSign size={40} color={DONATIONS_COLORS.mutedText} />
      <Text style={styles.emptyTitle}>No donations yet</Text>
      <Text style={styles.emptySubtitle}>
        Donations will appear here after payments are completed via Stripe.
      </Text>
    </View>
  );

  if (error) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.navHeader}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "D"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Donations</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading donations: {error}</Text>
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
          <View style={styles.navHeader}>
            {/* Logo */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "D"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Donations</Text>
              <Text style={styles.headerMeta}>
                {donationCount} {donationCount === 1 ? "contribution" : "contributions"} · $
                {formatCurrency(totalAmount * 100)}
              </Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Donation options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <FlatList
        data={donations}
        renderItem={renderDonationItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={!loading ? renderEmptyState : null}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={DONATIONS_COLORS.primaryCTA}
          />
        }
      />
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: DONATIONS_COLORS.background,
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
    // List content
    listContent: {
      padding: spacing.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    headerContent: {
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    // Stats cards
    statsRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    statCard: {
      flex: 1,
      backgroundColor: DONATIONS_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: DONATIONS_COLORS.border,
      padding: spacing.sm,
      alignItems: "center",
    },
    statLabel: {
      fontSize: fontSize.xs,
      color: DONATIONS_COLORS.secondaryText,
      marginBottom: 4,
    },
    statValue: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: DONATIONS_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    // Donate button
    donateButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: DONATIONS_COLORS.primaryCTA,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    donateButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: DONATIONS_COLORS.primaryCTAText,
    },
    // Purpose section
    purposeSection: {
      backgroundColor: DONATIONS_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: DONATIONS_COLORS.border,
      padding: spacing.md,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: DONATIONS_COLORS.primaryText,
      marginBottom: spacing.sm,
    },
    purposeList: {
      gap: spacing.sm,
    },
    purposeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: DONATIONS_COLORS.sectionBackground,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
    },
    purposeLabel: {
      fontSize: fontSize.sm,
      color: DONATIONS_COLORS.primaryText,
      flex: 1,
    },
    purposeAmount: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: DONATIONS_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    // Donation card
    donationCard: {
      backgroundColor: DONATIONS_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: DONATIONS_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    donationHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: spacing.xs,
    },
    donorInfo: {
      flex: 1,
      marginRight: spacing.sm,
    },
    donorName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: DONATIONS_COLORS.primaryText,
    },
    donorEmail: {
      fontSize: fontSize.sm,
      color: DONATIONS_COLORS.secondaryText,
      marginTop: 2,
    },
    donationAmount: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: DONATIONS_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    donationFooter: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    donationPurpose: {
      fontSize: fontSize.sm,
      color: DONATIONS_COLORS.secondaryText,
      flex: 1,
    },
    donationMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    donationDate: {
      fontSize: fontSize.sm,
      color: DONATIONS_COLORS.mutedText,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
    },
    statusText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      textTransform: "capitalize",
    },
    // Empty state
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      paddingHorizontal: spacing.md,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: DONATIONS_COLORS.primaryText,
      marginTop: spacing.md,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: DONATIONS_COLORS.secondaryText,
      marginTop: spacing.xs,
      textAlign: "center",
    },
    // Error state
    errorContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
    },
    errorText: {
      color: DONATIONS_COLORS.error,
      textAlign: "center",
      fontSize: fontSize.base,
    },
  });
