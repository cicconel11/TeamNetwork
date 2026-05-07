import { useMemo, useState, useCallback, useRef, useEffect } from "react";
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
import { ArrowUpDown, Users, Search } from "lucide-react-native";
import { useMemberDirectory, type DirectoryMember } from "@/hooks/useMemberDirectory";
import { useOrg } from "@/contexts/OrgContext";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import {
  DirectorySearchBar,
  DirectoryFilterChipsRow,
  DirectoryCard,
  DirectorySkeleton,
  DirectoryEmptyState,
} from "@/components/directory";
import { ErrorState } from "@/components/ui";

type RoleFilter = "all" | "admin" | "member";
type SortOption = "name" | "year";

export default function MembersScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  // Use orgId from context for data hook (eliminates redundant org fetch)
  const { members, loading, error, refetch, refetchIfStale } = useMemberDirectory(orgId);
  const { neutral, semantic } = useAppColorScheme();
  const { isOffline } = useNetwork();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleFilter>("all");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const isRefetchingRef = useRef(false);

  // Local colors for directory components (dynamic)
  const directoryColors = useMemo(() => ({
    background: neutral.surface,
    foreground: neutral.foreground,
    card: neutral.surface,
    border: neutral.border,
    muted: neutral.muted,
    mutedForeground: neutral.secondary,
    primary: semantic.success,
    primaryLight: semantic.successLight,
    primaryDark: semantic.successDark,
    primaryForeground: "#ffffff",
    secondary: semantic.info,
    secondaryLight: semantic.infoLight,
    secondaryDark: semantic.infoDark,
    secondaryForeground: "#ffffff",
    mutedSurface: neutral.background,
    success: semantic.success,
    warning: semantic.warning,
    error: semantic.error,
  }), [neutral, semantic]);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
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
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    listHeader: {
      backgroundColor: n.surface,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      gap: SPACING.md,
    },
    sortButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: SPACING.sm + 2,
      paddingVertical: SPACING.sm,
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
    },
    sortButtonPressed: {
      opacity: 0.7,
    },
    sortButtonText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
    },
    listContent: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.xl,
      flexGrow: 1,
    },
  }));

  const hasActiveFilters = !!(searchQuery || selectedRole !== "all" || selectedYear);

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

  const renderMemberCard = useCallback(
    ({ item }: { item: DirectoryMember }) => {
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
          colors={directoryColors}
        />
      );
    },
    [handleMemberPress, directoryColors]
  );

  const roleOptions: { value: RoleFilter; label: string }[] = [
    { value: "admin", label: "Admin" },
    { value: "member", label: "Member" },
  ];

  const renderListHeader = () => (
    <View style={styles.listHeader}>
      <DirectorySearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search members..."
        colors={directoryColors}
        rightSlot={
          <Pressable
            onPress={toggleSort}
            style={({ pressed }) => [styles.sortButton, pressed && styles.sortButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${sortBy === "name" ? "year" : "name"}`}
          >
            <ArrowUpDown size={14} color={neutral.muted} />
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
            onSelect: (opt) => setSelectedRole(((opt as { value: string } | null)?.value || "all") as RoleFilter),
            keyExtractor: (r) => (r as { value: string }).value,
            labelExtractor: (r) => (r as { label: string }).label,
          },
          {
            label: "Class",
            options: years,
            selected: selectedYear,
            onSelect: (v) => setSelectedYear(v as number | null),
            labelExtractor: (y) => String(y),
          },
        ]}
        colors={directoryColors}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAllFilters}
      />
    </View>
  );

  const renderEmpty = () => {
    if (hasActiveFilters) {
      return (
        <DirectoryEmptyState
          icon={<Search size={40} color={neutral.border} />}
          title="No results found"
          subtitle="Try adjusting your search or filters"
          colors={directoryColors}
          showClearButton
          onClear={clearAllFilters}
        />
      );
    }
    return (
      <DirectoryEmptyState
        icon={<Users size={40} color={neutral.border} />}
        title="No members yet"
        subtitle="Members will appear here once added to this organization"
        colors={directoryColors}
      />
    );
  };

  // Error state
  if (error && members.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable
                onPress={handleDrawerToggle}
                style={styles.orgLogoButton}
                accessibilityRole="button"
                accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
              >
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Members</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <ErrorState
            onRetry={handleRefresh}
            title="Unable to load members"
            isOffline={isOffline}
          />
        </View>
      </View>
    );
  }

  // Loading state
  if (loading && members.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable
                onPress={handleDrawerToggle}
                style={styles.orgLogoButton}
                accessibilityRole="button"
                accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
              >
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Members</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <DirectorySkeleton colors={directoryColors} />
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
            <Pressable
              onPress={handleDrawerToggle}
              style={styles.orgLogoButton}
              accessibilityRole="button"
              accessibilityLabel={`Open navigation for ${orgName ?? "organization"}`}
            >
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Members</Text>
              <Text style={styles.headerMeta}>
                {members.length} {members.length === 1 ? "member" : "members"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <FlatList
          data={filteredMembers}
          keyExtractor={(item) => item.id}
          renderItem={renderMemberCard}
          contentContainerStyle={styles.listContent}
          stickyHeaderIndices={[0]}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={semantic.success} />
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
