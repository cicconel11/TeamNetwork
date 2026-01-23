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
import { ArrowUpDown, Users, Search } from "lucide-react-native";
import { useMemberDirectory, type DirectoryMember } from "@/hooks/useMemberDirectory";
import { useOrg } from "@/contexts/OrgContext";
import { supabase } from "@/lib/supabase";
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
  error: SEMANTIC.error,
};

type RoleFilter = "all" | "admin" | "member";
type SortOption = "name" | "year";

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export default function MembersScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { orgSlug } = useOrg();
  const { members, loading, error, refetch, refetchIfStale } = useMemberDirectory(orgSlug || "");
  const styles = useMemo(() => createStyles(), []);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleFilter>("all");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const isRefetchingRef = useRef(false);

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

  // Fetch organization data
  useEffect(() => {
    async function fetchOrg() {
      if (!orgSlug) return;
      const { data } = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url")
        .eq("slug", orgSlug)
        .single();
      if (data) setOrganization(data);
    }
    fetchOrg();
  }, [orgSlug]);

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
        colors={DIRECTORY_COLORS}
      />
    );
  };

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
        title="No members yet"
        subtitle="Members will appear here once added to this organization"
        colors={DIRECTORY_COLORS}
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
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {organization?.logo_url ? (
                  <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{organization?.name?.[0] || "?"}</Text>
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
          <DirectoryErrorState
            title="Unable to load members"
            message={error}
            colors={DIRECTORY_COLORS}
            onRetry={handleRefresh}
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
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {organization?.logo_url ? (
                  <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{organization?.name?.[0] || "?"}</Text>
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
              {organization?.logo_url ? (
                <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{organization?.name?.[0] || "?"}</Text>
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
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SEMANTIC.success} />
          }
          keyboardShouldPersistTaps="handled"
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
      borderTopLeftRadius: RADIUS.xxl,
      borderTopRightRadius: RADIUS.xxl,
      marginTop: -16,
      overflow: "hidden",
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
