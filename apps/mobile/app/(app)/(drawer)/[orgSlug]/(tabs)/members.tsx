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
import { ArrowUpDown, Users, Search } from "lucide-react-native";
import { useMemberDirectory, type DirectoryMember } from "@/hooks/useMemberDirectory";
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

type RoleFilter = "all" | "admin" | "member";
type SortOption = "name" | "year";

export default function MembersScreen() {
  const router = useRouter();
  const { orgSlug } = useOrg();
  const { members, loading, error, refetch, refetchIfStale } = useMemberDirectory(orgSlug || "");
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleFilter>("all");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const isRefetchingRef = useRef(false);

  const hasActiveFilters = !!(searchQuery || selectedRole !== "all" || selectedYear);

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
    setSelectedRole("all");
    setSelectedYear(null);
  }, []);

  const toggleSort = useCallback(() => {
    setSortBy((prev) => (prev === "name" ? "year" : "name"));
  }, []);

  const years = useMemo(() => {
    const yearSet = new Set<number>();
    members.forEach((m) => {
      if (m.graduation_year) yearSet.add(m.graduation_year);
    });
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [members]);

  const filteredMembers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let result = members.filter((m) => {
      if (selectedRole === "admin" && m.role !== "admin") return false;
      if (selectedRole === "member" && m.role === "admin") return false;
      if (selectedYear && m.graduation_year !== selectedYear) return false;
      if (!q) return true;
      const searchable = [m.first_name, m.last_name, m.email, m.graduation_year?.toString()]
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
  }, [members, searchQuery, selectedRole, selectedYear, sortBy]);

  const getInitials = (member: DirectoryMember) => {
    if (member.first_name && member.last_name) {
      return (member.first_name[0] + member.last_name[0]).toUpperCase();
    }
    return member.first_name?.[0]?.toUpperCase() || "?";
  };

  const getDisplayName = (member: DirectoryMember) => {
    if (member.first_name && member.last_name) return `${member.first_name} ${member.last_name}`;
    return member.first_name || member.email || "Unknown";
  };

  const getRoleLabel = (role: string | null) => {
    if (role === "admin") return "Admin";
    return "Member";
  };

  const handleMemberPress = useCallback(
    (member: DirectoryMember) => {
      router.push(`/(app)/${orgSlug}/members/${member.id}`);
    },
    [router, orgSlug]
  );

  const renderMemberCard = ({ item }: { item: DirectoryMember }) => {
    const chips: { label: string; key: string }[] = [];
    if (item.graduation_year) chips.push({ label: `'${String(item.graduation_year).slice(-2)}`, key: "year" });
    if (item.role) chips.push({ label: getRoleLabel(item.role), key: "role" });

    return (
      <DirectoryCard
        avatarUrl={item.photo_url}
        initials={getInitials(item)}
        name={getDisplayName(item)}
        subtitle={item.email}
        chips={chips}
        onPress={() => handleMemberPress(item)}
        colors={colors}
      />
    );
  };

  const roleOptions: { value: RoleFilter; label: string }[] = [
    { value: "admin", label: "Admin" },
    { value: "member", label: "Member" },
  ];

  const renderHeader = () => (
    <View style={styles.header}>
      <DirectorySearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search members..."
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
            label: "Role",
            options: roleOptions,
            selected: selectedRole !== "all" ? roleOptions.find((r) => r.value === selectedRole) || null : null,
            onSelect: (opt) => setSelectedRole(opt?.value || "all"),
            keyExtractor: (r) => r.value,
            labelExtractor: (r) => r.label,
          },
          {
            label: "Class",
            options: years,
            selected: selectedYear,
            onSelect: setSelectedYear,
            labelExtractor: (y) => String(y),
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
        title="No members yet"
        subtitle="Members will appear here once added to this organization"
        colors={colors}
      />
    );
  };

  if (error && members.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Members" }} />
        <DirectoryErrorState
          title="Unable to load members"
          message={error}
          colors={colors}
          onRetry={handleRefresh}
        />
      </View>
    );
  }

  if (loading && members.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Members" }} />
        <DirectorySkeleton colors={colors} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Members" }} />
      <FlatList
        data={filteredMembers}
        keyExtractor={(item) => item.id}
        renderItem={renderMemberCard}
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
