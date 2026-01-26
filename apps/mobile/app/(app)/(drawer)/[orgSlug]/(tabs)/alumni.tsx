import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { MapPin, ArrowUpDown, Users, Search } from "lucide-react-native";
import { useAlumni } from "@/hooks/useAlumni";
import { useOrg } from "@/contexts/OrgContext";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  DirectorySearchBar,
  DirectoryFilterChipsRow,
  DirectoryCard,
  DirectorySkeleton,
  DirectoryEmptyState,
  DirectoryErrorState,
} from "@/components/directory";

// Local colors for directory components (legacy compat)
const DIRECTORY_COLORS = {
  background: NEUTRAL.surface,
  foreground: NEUTRAL.foreground,
  card: NEUTRAL.surface,
  border: NEUTRAL.border,
  muted: NEUTRAL.muted,
  mutedForeground: NEUTRAL.secondary,
  primary: SEMANTIC.success,
  primaryLight: SEMANTIC.successLight,
  primaryDark: SEMANTIC.successDark,
  primaryForeground: "#ffffff",
  secondary: SEMANTIC.info,
  secondaryLight: SEMANTIC.infoLight,
  secondaryDark: SEMANTIC.infoDark,
  secondaryForeground: "#ffffff",
  mutedSurface: NEUTRAL.background,
  success: SEMANTIC.success,
  warning: SEMANTIC.warning,
  error: SEMANTIC.error,
};

type Alumni = ReturnType<typeof useAlumni>["alumni"][number];
type SortOption = "name" | "year";

export default function AlumniScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  // Use orgId from context for data hook (eliminates redundant org fetch)
  const { alumni, loading, error, refetch, refetchIfStale } = useAlumni(orgId);
  const styles = useMemo(() => createStyles(), []);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const isRefetchingRef = useRef(false);

  const hasActiveFilters = !!(searchQuery || selectedYear || selectedIndustry);

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

  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedYear(null);
    setSelectedIndustry(null);
  }, []);

  const toggleSort = useCallback(() => {
    setSortBy((prev) => (prev === "name" ? "year" : "name"));
  }, []);

  const { years, industries } = useMemo(() => {
    const yearSet = new Set<number>();
    const industrySet = new Set<string>();
    alumni.forEach((a) => {
      if (a.graduation_year) yearSet.add(a.graduation_year);
      if (a.industry) industrySet.add(a.industry);
    });
    return {
      years: Array.from(yearSet).sort((a, b) => b - a),
      industries: Array.from(industrySet).sort(),
    };
  }, [alumni]);

  const filteredAlumni = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let result = alumni.filter((a) => {
      if (selectedYear && a.graduation_year !== selectedYear) return false;
      if (selectedIndustry && a.industry !== selectedIndustry) return false;
      if (!q) return true;
      const searchable = [
        a.first_name,
        a.last_name,
        a.position_title,
        a.job_title,
        a.current_company,
        a.current_city,
        a.industry,
        a.graduation_year?.toString(),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });

    result = [...result].sort((a, b) => {
      if (sortBy === "year") {
        const yearA = a.graduation_year ?? 0;
        const yearB = b.graduation_year ?? 0;
        return yearB - yearA;
      }
      const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
      const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return result;
  }, [alumni, searchQuery, selectedYear, selectedIndustry, sortBy]);

  const getInitials = (alum: Alumni) => {
    if (alum.first_name && alum.last_name) {
      return (alum.first_name[0] + alum.last_name[0]).toUpperCase();
    }
    return alum.first_name?.[0]?.toUpperCase() || "?";
  };

  const getDisplayName = (alum: Alumni) => {
    if (alum.first_name && alum.last_name) return `${alum.first_name} ${alum.last_name}`;
    return alum.first_name || alum.email || "Unknown";
  };

  const getRoleCompany = (alum: Alumni) => {
    const title = alum.position_title || alum.job_title;
    if (title && alum.current_company) return `${title} at ${alum.current_company}`;
    return title || alum.current_company || null;
  };

  const handleAlumniPress = useCallback(
    (alum: Alumni) => {
      router.push(`/(app)/${orgSlug}/alumni/${alum.id}`);
    },
    [router, orgSlug]
  );

  const renderAlumniCard = useCallback(
    ({ item }: { item: Alumni }) => {
      const chips: { label: string; key: string }[] = [];
      if (item.graduation_year) chips.push({ label: `'${String(item.graduation_year).slice(-2)}`, key: "year" });
      if (item.industry && chips.length < 2) chips.push({ label: item.industry, key: "industry" });

      return (
        <DirectoryCard
          avatarUrl={item.photo_url}
          initials={getInitials(item)}
          name={getDisplayName(item)}
          subtitle={getRoleCompany(item)}
          locationLine={item.current_city}
          locationIcon={item.current_city ? <MapPin size={11} color={NEUTRAL.secondary} /> : undefined}
          chips={chips}
          onPress={() => handleAlumniPress(item)}
          colors={DIRECTORY_COLORS}
        />
      );
    },
    [handleAlumniPress]
  );

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      <DirectorySearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search alumni..."
        colors={DIRECTORY_COLORS}
        rightSlot={
          <Pressable
            onPress={toggleSort}
            style={({ pressed }) => [styles.sortButton, pressed && styles.sortButtonPressed]}
          >
            <ArrowUpDown size={14} color={NEUTRAL.muted} />
            <Text style={styles.sortButtonText}>{sortBy === "name" ? "A-Z" : "Year"}</Text>
          </Pressable>
        }
      />
      <DirectoryFilterChipsRow
        groups={[
          {
            label: "Class",
            options: years,
            selected: selectedYear,
            onSelect: (v) => setSelectedYear(v as number | null),
            labelExtractor: (y) => String(y),
          },
          {
            label: "Industry",
            options: industries,
            selected: selectedIndustry,
            onSelect: (v) => setSelectedIndustry(v as string | null),
          },
        ]}
        colors={DIRECTORY_COLORS}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAllFilters}
      />
    </View>
  );

  const renderEmpty = () => {
    if (hasActiveFilters) {
      return (
        <DirectoryEmptyState
          icon={<Search size={40} color={NEUTRAL.border} />}
          title="No results found"
          subtitle="Try adjusting your search or filters"
          colors={DIRECTORY_COLORS}
          showClearButton
          onClear={clearAllFilters}
        />
      );
    }
    return (
      <DirectoryEmptyState
        icon={<Users size={40} color={NEUTRAL.border} />}
        title="No alumni yet"
        subtitle="Alumni will appear here once added to this organization"
        colors={DIRECTORY_COLORS}
      />
    );
  };

  // Error state
  if (error && alumni.length === 0) {
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
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Alumni</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <DirectoryErrorState
            title="Unable to load alumni"
            message={error}
            colors={DIRECTORY_COLORS}
            onRetry={handleRefresh}
          />
        </View>
      </View>
    );
  }

  // Loading state
  if (loading && alumni.length === 0) {
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
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Alumni</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <DirectorySkeleton colors={DIRECTORY_COLORS} />
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
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Alumni</Text>
              <Text style={styles.headerMeta}>
                {alumni.length} {alumni.length === 1 ? "alum" : "alumni"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={filteredAlumni}
          keyExtractor={(item) => item.id}
          renderItem={renderAlumniCard}
          contentContainerStyle={styles.listContent}
          stickyHeaderIndices={[0]}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />
          }
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          updateCellsBatchingPeriod={50}
        />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
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
    listHeader: {
      backgroundColor: NEUTRAL.surface,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      gap: SPACING.md,
    },
    sortButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: SPACING.sm + 2,
      paddingVertical: SPACING.sm,
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.md,
    },
    sortButtonPressed: {
      opacity: 0.7,
    },
    sortButtonText: {
      ...TYPOGRAPHY.labelSmall,
      color: NEUTRAL.muted,
    },
    listContent: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.xl,
      flexGrow: 1,
    },
  });
