import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  SectionList,
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
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useRecords } from "@/hooks/useRecords";
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
import type { Record } from "@teammeet/types";

interface RecordsByCategory {
  category: string;
  data: Record[];
}

export default function RecordsScreen() {
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const navigation = useNavigation();
  const { permissions } = useOrgRole();
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
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
    chipContainer: {
      maxHeight: 48,
      backgroundColor: n.surface,
    },
    chipContent: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.full,
      backgroundColor: n.background,
    },
    chipActive: {
      backgroundColor: s.success,
    },
    chipText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.muted,
    },
    chipTextActive: {
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    recordCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous" as const,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    recordHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      marginBottom: SPACING.xs,
    },
    recordTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
      marginRight: SPACING.sm,
    },
    yearBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      borderRadius: RADIUS.sm,
      backgroundColor: n.background,
    },
    yearText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
    },
    recordValue: {
      ...TYPOGRAPHY.displayMedium,
      color: s.success,
      fontVariant: ["tabular-nums"] as const,
      marginBottom: SPACING.xs,
    },
    recordHolder: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    notesContainer: {
      marginTop: SPACING.sm,
      paddingTop: SPACING.sm,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    recordNotes: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      lineHeight: 20,
    },
    emptyState: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: 64,
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
    skeletonContainer: {
      padding: SPACING.md,
    },
  }));
  const { isOffline } = useNetwork();
  const { records, categories, loading, error, refetch, refetchIfStale } = useRecords(orgId);
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
        icon: <ExternalLink size={20} color={semantic.success} />,
        onPress: () => {
          const webUrl = getWebPath(orgSlug, "records");
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
      <Trophy size={18} color={semantic.warning} />
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
      <Trophy size={48} color={semantic.warning} />
      <Text style={styles.emptyTitle}>No records yet</Text>
      <Text style={styles.emptySubtitle}>
        Add records to create your organization's record book
      </Text>
    </View>
  );

  const renderHeader = () => (
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
            <Text style={styles.headerMeta}>{headerSubtitle}</Text>
          </View>
          {adminMenuItems.length > 0 && (
            <OverflowMenu items={adminMenuItems} accessibilityLabel="Records options" />
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );

  if (loading && records.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.skeletonContainer}>
          <SkeletonList type="event" count={4} />
        </Animated.View>
      </View>
    );
  }

  if (error && records.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <ErrorState
          onRetry={handleRefresh}
          title="Unable to load records"
          isOffline={isOffline}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}

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
            tintColor={semantic.success}
          />
        }
      />
    </View>
  );
}
