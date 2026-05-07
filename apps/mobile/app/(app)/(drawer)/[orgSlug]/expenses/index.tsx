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
import { Receipt, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useExpenses } from "@/hooks/useExpenses";
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
import { formatMonthDayYearSafe } from "@/lib/date-format";
import type { Expense } from "@teammeet/types";

export default function ExpensesScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
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
    submitButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      paddingVertical: SPACING.sm,
      gap: SPACING.xs,
    },
    submitButtonText: {
      ...TYPOGRAPHY.titleSmall,
      color: "#ffffff",
    },
    totalCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      alignItems: "center" as const,
      ...SHADOWS.sm,
    },
    totalLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
      marginBottom: 4,
    },
    totalValue: {
      ...TYPOGRAPHY.displayMedium,
      color: n.foreground,
      fontVariant: ["tabular-nums"] as const,
    },
    totalCount: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginTop: 4,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    expenseCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    expenseHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
    },
    expenseInfo: {
      flex: 1,
      marginRight: SPACING.sm,
    },
    nameRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      flexWrap: "wrap" as const,
      marginBottom: 4,
    },
    expenseName: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    typeBadge: {
      backgroundColor: n.background,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      borderRadius: RADIUS.full,
    },
    typeText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
    },
    expenseAmount: {
      ...TYPOGRAPHY.displayMedium,
      color: s.success,
      fontVariant: ["tabular-nums"] as const,
      marginVertical: 4,
    },
    submitterText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    expenseDate: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    expenseActions: {
      flexDirection: "column" as const,
      alignItems: "flex-end" as const,
      gap: SPACING.sm,
    },
    venmoButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: RADIUS.md,
      backgroundColor: "#008CFF",
    },
    venmoButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
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
  const { expenses, total, loading, error, refetch, refetchIfStale } =
    useExpenses(orgId, { isAdmin });
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
          const webUrl = getWebPath(orgSlug, "expenses");
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

  const handleSubmitExpense = useCallback(() => {
    router.push(`/(app)/${orgSlug}/expenses/new`);
  }, [router, orgSlug]);

  const handleVenmoPress = useCallback((venmoLink: string) => {
    Linking.openURL(venmoLink);
  }, []);

  // Format currency
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (dateString: string | null) => {
    return formatMonthDayYearSafe(dateString, "");
  };

  const renderExpenseItem = ({ item }: { item: Expense }) => {
    return (
      <View style={styles.expenseCard}>
        <View style={styles.expenseHeader}>
          <View style={styles.expenseInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.expenseName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeText}>{item.expense_type}</Text>
              </View>
            </View>
            <Text style={styles.expenseAmount}>
              ${formatCurrency(Number(item.amount))}
            </Text>
            {isAdmin && item.user_id && (
              <Text style={styles.submitterText}>Submitted by {item.name}</Text>
            )}
            <Text style={styles.expenseDate}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={styles.expenseActions}>
            {item.venmo_link && (
              <Pressable
                style={({ pressed }) => [styles.venmoButton, pressed && { opacity: 0.7 }]}
                onPress={() => handleVenmoPress(item.venmo_link!)}
              >
                <Text style={styles.venmoButtonText}>Venmo</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderListHeader = () => (
    <View style={styles.headerContent}>
      {/* Submit Expense Button */}
      <Pressable style={({ pressed }) => [styles.submitButton, pressed && { opacity: 0.7 }]} onPress={handleSubmitExpense}>
        <Plus size={20} color="#ffffff" />
        <Text style={styles.submitButtonText}>Submit Expense</Text>
      </Pressable>

      {/* Total Card */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>${formatCurrency(total)}</Text>
        <Text style={styles.totalCount}>
          {expenses.length} {expenses.length === 1 ? "expense" : "expenses"}
        </Text>
      </View>

      {/* Expenses List Header */}
      <Text style={styles.sectionTitle}>Recent Expenses</Text>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Receipt size={40} color={semantic.success} />
      <Text style={styles.emptyTitle}>No expenses yet</Text>
      <Text style={styles.emptySubtitle}>
        Submit an expense to request reimbursement
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
                <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Expenses</Text>
            <Text style={styles.headerMeta}>
              {expenses.length} {expenses.length === 1 ? "expense" : "expenses"}{" "}
              totaling ${formatCurrency(total)}
            </Text>
          </View>
          {adminMenuItems.length > 0 && (
            <OverflowMenu items={adminMenuItems} accessibilityLabel="Expense options" />
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (loading && expenses.length === 0) {
    return (
      <View style={styles.container}>
        {renderNavHeader()}
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.skeletonContainer}>
          <SkeletonList type="event" count={4} />
        </Animated.View>
      </View>
    );
  }

  if (error && expenses.length === 0) {
    return (
      <View style={styles.container}>
        {renderNavHeader()}
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load expenses"
          isOffline={isOffline}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderNavHeader()}
      <FlatList
        data={expenses}
        renderItem={renderExpenseItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
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
