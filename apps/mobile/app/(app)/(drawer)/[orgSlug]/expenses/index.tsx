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
import { Receipt, ExternalLink, Plus } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useExpenses } from "@/hooks/useExpenses";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { Expense } from "@teammeet/types";

// Local colors for expenses screen
const EXPENSES_COLORS = {
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

  // Venmo
  venmo: "#008CFF",
  venmoHover: "#0070CC",

  // States
  error: "#ef4444",
  errorBackground: "#fef2f2",
};

export default function ExpensesScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const { expenses, total, loading, error, refetch, refetchIfStale } =
    useExpenses(orgSlug || "", { isAdmin });
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
        icon: <ExternalLink size={20} color={EXPENSES_COLORS.primaryCTA} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/expenses`;
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
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
              <TouchableOpacity
                style={styles.venmoButton}
                onPress={() => handleVenmoPress(item.venmo_link!)}
              >
                <Text style={styles.venmoButtonText}>Venmo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContent}>
      {/* Submit Expense Button */}
      <TouchableOpacity style={styles.submitButton} onPress={handleSubmitExpense}>
        <Plus size={20} color={EXPENSES_COLORS.primaryCTAText} />
        <Text style={styles.submitButtonText}>Submit Expense</Text>
      </TouchableOpacity>

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
      <Receipt size={40} color={EXPENSES_COLORS.mutedText} />
      <Text style={styles.emptyTitle}>No expenses yet</Text>
      <Text style={styles.emptySubtitle}>
        Submit an expense to request reimbursement
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
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Expenses</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading expenses: {error}</Text>
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
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "E"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Expenses</Text>
              <Text style={styles.headerMeta}>
                {expenses.length} {expenses.length === 1 ? "expense" : "expenses"}{" "}
                totaling ${formatCurrency(total)}
              </Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Expense options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <FlatList
        data={expenses}
        renderItem={renderExpenseItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={!loading ? renderEmptyState : null}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={EXPENSES_COLORS.primaryCTA}
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
      backgroundColor: EXPENSES_COLORS.background,
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
    // Submit button
    submitButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: EXPENSES_COLORS.primaryCTA,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    submitButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: EXPENSES_COLORS.primaryCTAText,
    },
    // Total card
    totalCard: {
      backgroundColor: EXPENSES_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      padding: spacing.md,
      alignItems: "center",
    },
    totalLabel: {
      fontSize: fontSize.sm,
      color: EXPENSES_COLORS.secondaryText,
      marginBottom: 4,
    },
    totalValue: {
      fontSize: 28,
      fontWeight: fontWeight.bold,
      color: EXPENSES_COLORS.primaryText,
      fontVariant: ["tabular-nums"],
    },
    totalCount: {
      fontSize: fontSize.sm,
      color: EXPENSES_COLORS.mutedText,
      marginTop: 4,
    },
    // Section title
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: EXPENSES_COLORS.primaryText,
    },
    // Expense card
    expenseCard: {
      backgroundColor: EXPENSES_COLORS.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: EXPENSES_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    expenseHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    expenseInfo: {
      flex: 1,
      marginRight: spacing.sm,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flexWrap: "wrap",
      marginBottom: 4,
    },
    expenseName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: EXPENSES_COLORS.primaryText,
    },
    typeBadge: {
      backgroundColor: EXPENSES_COLORS.sectionBackground,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.lg,
    },
    typeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: EXPENSES_COLORS.secondaryText,
    },
    expenseAmount: {
      fontSize: 24,
      fontWeight: fontWeight.bold,
      color: EXPENSES_COLORS.primaryCTA,
      fontVariant: ["tabular-nums"],
      marginVertical: 4,
    },
    submitterText: {
      fontSize: fontSize.xs,
      color: EXPENSES_COLORS.mutedText,
      marginTop: 2,
    },
    expenseDate: {
      fontSize: fontSize.xs,
      color: EXPENSES_COLORS.mutedText,
      marginTop: 2,
    },
    expenseActions: {
      flexDirection: "column",
      alignItems: "flex-end",
      gap: spacing.sm,
    },
    venmoButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: borderRadius.md,
      backgroundColor: EXPENSES_COLORS.venmo,
    },
    venmoButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: "#ffffff",
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
      color: EXPENSES_COLORS.primaryText,
      marginTop: spacing.md,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: EXPENSES_COLORS.secondaryText,
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
      color: EXPENSES_COLORS.error,
      textAlign: "center",
      fontSize: fontSize.base,
    },
  });
