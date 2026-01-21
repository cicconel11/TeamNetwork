import { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { MapPin, ArrowUpDown, Users, Search } from "lucide-react-native";
import { useAlumni } from "@/hooks/useAlumni";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";
import {
  DirectorySearchBar,
  DirectoryFilterChipsRow,
  DirectoryCard,
  DirectorySkeleton,
  DirectoryEmptyState,
  DirectoryErrorState,
} from "@/components/directory";

type Alumni = ReturnType<typeof useAlumni>["alumni"][number];
type SortOption = "name" | "year";

export default function AlumniScreen() {
  const router = useRouter();
  const { orgSlug } = useOrg();
  const { alumni, loading, error, refetch, refetchIfStale } = useAlumni(orgSlug || "");
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const isRefetchingRef = useRef(false);

  const hasActiveFilters = !!(searchQuery || selectedYear || selectedIndustry);

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
      router.push(`/${orgSlug}/alumni/${alum.id}`);
    },
    [router, orgSlug]
  );

  const renderAlumniCard = ({ item }: { item: Alumni }) => {
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
        locationIcon={item.current_city ? <MapPin size={11} color={colors.mutedForeground} /> : undefined}
        chips={chips}
        onPress={() => handleAlumniPress(item)}
        colors={colors}
      />
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <DirectorySearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search alumni..."
        colors={colors}
        rightSlot={
          <Pressable
            onPress={toggleSort}
            style={({ pressed }) => [styles.sortButton, pressed && styles.sortButtonPressed]}
          >
            <ArrowUpDown size={14} color={colors.muted} />
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
            onSelect: setSelectedYear,
            labelExtractor: (y) => String(y),
          },
          {
            label: "Industry",
            options: industries,
            selected: selectedIndustry,
            onSelect: setSelectedIndustry,
          },
        ]}
        colors={colors}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAllFilters}
      />
    </View>
  );

  const renderEmpty = () => {
    if (hasActiveFilters) {
      return (
        <DirectoryEmptyState
          icon={<Search size={40} color={colors.border} />}
          title="No results found"
          subtitle="Try adjusting your search or filters"
          colors={colors}
          showClearButton
          onClear={clearAllFilters}
        />
      );
    }
    return (
      <DirectoryEmptyState
        icon={<Users size={40} color={colors.border} />}
        title="No alumni yet"
        subtitle="Alumni will appear here once added to this organization"
        colors={colors}
      />
    );
  };

  if (error && alumni.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Alumni" }} />
        <DirectoryErrorState
          title="Unable to load alumni"
          message={error}
          colors={colors}
          onRetry={handleRefresh}
        />
      </View>
    );
  }

  if (loading && alumni.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Alumni" }} />
        <DirectorySkeleton colors={colors} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Alumni" }} />
      <FlatList
        data={filteredAlumni}
        keyExtractor={(item) => item.id}
        renderItem={renderAlumniCard}
        contentContainerStyle={styles.listContent}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      backgroundColor: colors.background,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },
    sortButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: borderRadius.md,
    },
    sortButtonPressed: {
      opacity: 0.7,
    },
    sortButtonText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.muted,
    },
    listContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      flexGrow: 1,
    },
  });
