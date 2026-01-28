import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation } from "expo-router";
import { Trophy, ExternalLink } from "lucide-react-native";
import * as Linking from "expo-linking";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useRecords } from "@/hooks/useRecords";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { Record } from "@teammeet/types";

// Local colors for records screen
const RECORDS_COLORS = {
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

  // Accent
  trophyColor: "#f59e0b", // amber-500 for trophy icon

  // States
  error: "#ef4444",
  errorBg: "#fee2e2",

  // Filter chips
  chipActive: "#059669",
  chipActiveText: "#ffffff",
  chipInactive: "#f1f5f9",
  chipInactiveText: "#64748b",
};

interface RecordsByCategory {
  category: string;
  data: Record[];
}

export default function RecordsScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);
  const { records, categories, loading, error, refetch, refetchIfStale } = useRecords(orgSlug || "");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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
        icon: <ExternalLink size={20} color={RECORDS_COLORS.primaryCTA} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/records`;
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

  // Filter records by selected category
  const filteredRecords = useMemo(() => {
    if (!selectedCategory) return records;
    return records.filter((r) => r.category === selectedCategory);
  }, [records, selectedCategory]);

  // Group records by category for SectionList
  const groupedRecords: RecordsByCategory[] = useMemo(() => {
    const grouped: { [key: string]: Record[] } = {};

    filteredRecords.forEach((record) => {
      const category = record.category || "General";
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(record);
    });

    return Object.entries(grouped).map(([category, data]) => ({
      category,
      data,
    }));
  }, [filteredRecords]);

  // Header subtitle
  const headerSubtitle = useMemo(() => {
    const count = filteredRecords.length;
    const categoryCount = selectedCategory ? 1 : categories.length || 1;
    return `${count} ${count === 1 ? "record" : "records"} in ${categoryCount} ${categoryCount === 1 ? "category" : "categories"}`;
  }, [filteredRecords.length, categories.length, selectedCategory]);

  const renderRecordCard = ({ item }: { item: Record }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordTitle}>{item.title}</Text>
        {item.year && (
          <View style={styles.yearBadge}>
            <Text style={styles.yearText}>{item.year}</Text>
          </View>
        )}
      </View>
      <Text style={styles.recordValue}>{item.value}</Text>
      <Text style={styles.recordHolder}>
        {item.holder_name}
        {item.year && ` • ${item.year}`}
      </Text>
      {item.notes && (
        <View style={styles.notesContainer}>
          <Text style={styles.recordNotes}>{item.notes}</Text>
        </View>
      )}
    </View>
  );

  const renderSectionHeader = ({ section }: { section: RecordsByCategory }) => (
    <View style={styles.sectionHeader}>
      <Trophy size={18} color={RECORDS_COLORS.trophyColor} />
      <Text style={styles.sectionTitle}>{section.category}</Text>
    </View>
  );

  const renderCategoryChips = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipContainer}
      contentContainerStyle={styles.chipContent}
    >
      <Pressable
        style={[
          styles.chip,
          selectedCategory === null && styles.chipActive,
        ]}
        onPress={() => setSelectedCategory(null)}
      >
        <Text
          style={[
            styles.chipText,
            selectedCategory === null && styles.chipTextActive,
          ]}
        >
          All Categories
        </Text>
      </Pressable>
      {categories.map((category) => (
        <Pressable
          key={category}
          style={[
            styles.chip,
            selectedCategory === category && styles.chipActive,
          ]}
          onPress={() => setSelectedCategory(category)}
        >
          <Text
            style={[
              styles.chipText,
              selectedCategory === category && styles.chipTextActive,
            ]}
          >
            {category}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Trophy size={48} color={RECORDS_COLORS.mutedText} />
      <Text style={styles.emptyTitle}>No records yet</Text>
      <Text style={styles.emptySubtitle}>
        Add records to create your organization's record book
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
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "R"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Records</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading records: {error}</Text>
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
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "R"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Records</Text>
              <Text style={styles.headerMeta}>{headerSubtitle}</Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Records options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Category Filter Chips */}
      {categories.length > 0 && renderCategoryChips()}

      {/* Records List */}
      <SectionList
        sections={groupedRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderRecordCard}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={!loading ? renderEmptyState : null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={RECORDS_COLORS.primaryCTA}
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
      backgroundColor: RECORDS_COLORS.background,
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
    // Category chips
    chipContainer: {
      maxHeight: 48,
      backgroundColor: RECORDS_COLORS.background,
    },
    chipContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      backgroundColor: RECORDS_COLORS.chipInactive,
      marginRight: spacing.sm,
    },
    chipActive: {
      backgroundColor: RECORDS_COLORS.chipActive,
    },
    chipText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: RECORDS_COLORS.chipInactiveText,
    },
    chipTextActive: {
      color: RECORDS_COLORS.chipActiveText,
    },
    // List content
    listContent: {
      padding: spacing.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Section header
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: RECORDS_COLORS.primaryText,
    },
    // Record card
    recordCard: {
      backgroundColor: RECORDS_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: RECORDS_COLORS.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    recordHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: spacing.xs,
    },
    recordTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: RECORDS_COLORS.primaryText,
      flex: 1,
      marginRight: spacing.sm,
    },
    yearBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      backgroundColor: RECORDS_COLORS.sectionBackground,
    },
    yearText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: RECORDS_COLORS.secondaryText,
    },
    recordValue: {
      fontSize: 24,
      fontWeight: fontWeight.bold,
      color: RECORDS_COLORS.primaryCTA,
      fontVariant: ["tabular-nums"],
      marginBottom: spacing.xs,
    },
    recordHolder: {
      fontSize: fontSize.sm,
      color: RECORDS_COLORS.secondaryText,
    },
    notesContainer: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: RECORDS_COLORS.border,
    },
    recordNotes: {
      fontSize: fontSize.sm,
      color: RECORDS_COLORS.mutedText,
      lineHeight: 20,
    },
    // Empty state
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 64,
      paddingHorizontal: spacing.md,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: RECORDS_COLORS.primaryText,
      marginTop: spacing.md,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: RECORDS_COLORS.secondaryText,
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
      color: RECORDS_COLORS.error,
      textAlign: "center",
      fontSize: fontSize.base,
    },
  });
