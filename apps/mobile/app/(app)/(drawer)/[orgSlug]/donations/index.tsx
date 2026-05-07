import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { DollarSign, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useDonations } from "@/hooks/useDonations";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { ErrorState, SkeletonList } from "@/components/ui";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonthDay } from "@/lib/date-format";
import type { OrganizationDonation } from "@teammeet/types";

export default function DonationsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const { semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    orgLogoButton: { width: 36, height: 36 },
    orgLogo: { width: 36, height: 36, borderRadius: 18 },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: { flex: 1 },
    headerTitle: { ...TYPOGRAPHY.titleLarge, color: APP_CHROME.headerTitle },
    headerMeta: {
      ...TYPOGRAPHY.caption,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    headerContent: {
      gap: SPACING.md,
      marginBottom: SPACING.md,
    },
    statsRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
    },
    statCard: {
      flex: 1,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.sm,
      alignItems: "center" as const,
      ...SHADOWS.sm,
    },
    statLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
      marginBottom: 4,
    },
    statValue: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
      fontVariant: ["tabular-nums"] as const,
    },
    donateButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      paddingVertical: SPACING.sm,
      gap: SPACING.xs,
    },
    donateButtonText: {
      ...TYPOGRAPHY.titleSmall,
      color: "#ffffff",
    },
    purposeSection: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    purposeList: { gap: SPACING.sm },
    purposeRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
    },
    purposeLabel: {
      ...TYPOGRAPHY.bodySmall,
      color: n.foreground,
      flex: 1,
    },
    purposeAmount: {
      ...TYPOGRAPHY.labelMedium,
      fontWeight: "600" as const,
      color: n.foreground,
      fontVariant: ["tabular-nums"] as const,
    },
    donationCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    donationHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      marginBottom: SPACING.xs,
    },
    donorInfo: { flex: 1, marginRight: SPACING.sm },
    donorName: { ...TYPOGRAPHY.titleMedium, color: n.foreground },
    donorEmail: { ...TYPOGRAPHY.bodySmall, color: n.secondary, marginTop: 2 },
    donationAmount: {
      ...TYPOGRAPHY.titleMedium,
      fontWeight: "700" as const,
      color: n.foreground,
      fontVariant: ["tabular-nums"] as const,
    },
    donationFooter: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
    },
    donationPurpose: { ...TYPOGRAPHY.bodySmall, color: n.secondary, flex: 1 },
    donationMeta: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    donationDate: { ...TYPOGRAPHY.caption, color: n.muted },
    statusBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      borderRadius: RADIUS.sm,
    },
    statusText: {
      ...TYPOGRAPHY.labelSmall,
      fontWeight: "600" as const,
      textTransform: "capitalize" as const,
    },
    emptyState: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: 48,
      paddingHorizontal: SPACING.md,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginTop: SPACING.xs,
      textAlign: "center" as const,
    },
    skeletonContainer: { padding: SPACING.md },
  }));
  const { isOffline } = useNetwork();
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
        icon: <ExternalLink size={20} color={semantic.success} />,
        onPress: () => {
          const webUrl = getWebPath(orgSlug, "donations");
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug, semantic.success]);

  // Refetch on screen focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  useAutoRefetchOnReconnect(refetch);

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
    return formatMonthDay(dateString);
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "succeeded":
        return { bg: semantic.successLight, text: semantic.success };
      case "failed":
        return { bg: semantic.errorLight, text: semantic.error };
      default:
        return { bg: semantic.warningLight, text: semantic.warning };
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
      <Pressable style={({ pressed }) => [styles.donateButton, pressed && { opacity: 0.7 }]} onPress={handleMakeDonation}>
        <Plus size={20} color="#ffffff" />
        <Text style={styles.donateButtonText}>Make a Donation</Text>
      </Pressable>

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
      <DollarSign size={40} color={semantic.success} />
      <Text style={styles.emptyTitle}>No donations yet</Text>
      <Text style={styles.emptySubtitle}>
        Donations will appear here after payments are completed via Stripe.
      </Text>
    </View>
  );

  const renderNavHeader = () => (
    <LinearGradient
      colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
      style={styles.headerGradient}
    >
      <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
        <View style={styles.navHeader}>
          <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
            {orgLogoUrl ? (
              <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
            ) : (
              <View style={styles.orgAvatar}>
                <Text style={styles.orgAvatarText}>{orgName?.[0] || "D"}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Donations</Text>
            <Text style={styles.headerMeta}>
              {donationCount} {donationCount === 1 ? "contribution" : "contributions"} · $
              {formatCurrency(totalAmount * 100)}
            </Text>
          </View>
          {adminMenuItems.length > 0 && (
            <OverflowMenu items={adminMenuItems} accessibilityLabel="Donation options" />
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (loading && donations.length === 0) {
    return (
      <View style={styles.container}>
        {renderNavHeader()}
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.skeletonContainer}>
          <SkeletonList type="event" count={4} />
        </Animated.View>
      </View>
    );
  }

  if (error && donations.length === 0) {
    return (
      <View style={styles.container}>
        {renderNavHeader()}
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load donations"
          isOffline={isOffline}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderNavHeader()}
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
            tintColor={semantic.success}
          />
        }
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
      />
    </View>
  );
}

