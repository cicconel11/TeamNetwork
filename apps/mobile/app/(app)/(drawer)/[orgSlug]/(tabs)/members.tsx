import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Image,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Dimensions,
  SectionList,
} from "react-native";

import { useFocusEffect, useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import { Search, SlidersHorizontal, Users, GraduationCap } from "lucide-react-native";
import { useMembers } from "@/hooks/useMembers";
import { useAlumni } from "@/hooks/useAlumni";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrg } from "@/contexts/OrgContext";
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { UserRole } from "@teammeet/types";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, borderRadius, fontSize, fontWeight, type ThemeColors } from "@/lib/theme";

type TabType = "members" | "alumni";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function MembersScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { permissions, isLoading: roleLoading } = useOrgRole();
  const canViewAlumni = permissions.canViewAlumni;
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  
  const { members, loading: membersLoading, error: membersError, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgSlug || "");
  // Only fetch alumni data if the user has permission to view it
  const { alumni, loading: alumniLoading, error: alumniError, refetch: refetchAlumni, refetchIfStale: refetchAlumniIfStale } = useAlumni(canViewAlumni ? (orgSlug || "") : "");

  const [activeTab, setActiveTab] = useState<TabType>("members");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "member">("all");
  const [alumniDecadeFilter, setAlumniDecadeFilter] = useState<string>("all");
  const tabIndicatorPosition = useSharedValue(0);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const handleTabChange = useCallback((tab: TabType) => {
    // Only allow switching to alumni tab if user has permission
    if (tab === "alumni" && !canViewAlumni) return;
    setActiveTab(tab);
    setFiltersVisible(false);
    tabIndicatorPosition.value = withTiming(tab === "members" ? 0 : 1, { duration: 200 });
  }, [tabIndicatorPosition, canViewAlumni]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          tabIndicatorPosition.value,
          [0, 1],
          [0, SCREEN_WIDTH / 2 - 32]
        ),
      },
    ],
  }));

  // Filter members by search and role
  const filteredMembers = useMemo(() => {
    let filtered = members;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((member) => {
        const name = member.user?.name?.toLowerCase() || "";
        const email = member.user?.email?.toLowerCase() || "";
        return name.includes(query) || email.includes(query);
      });
    }

    if (roleFilter !== "all") {
      filtered = filtered.filter((member) => {
        const role = normalizeRole(member.role as UserRole | null);
        const { isAdmin } = roleFlags(role);
        return roleFilter === "admin" ? isAdmin : !isAdmin;
      });
    }

    return [...filtered].sort((a, b) => {
      const nameA = (a.user?.name || a.user?.email || "").toLowerCase();
      const nameB = (b.user?.name || b.user?.email || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [members, searchQuery, roleFilter]);

  const alumniDecades = useMemo(() => {
    const decades = new Set<string>();
    alumni.forEach((a) => {
      const year = a.graduation_year;
      const decade = year ? `${Math.floor(year / 10) * 10}s` : "Unknown";
      decades.add(decade);
    });
    return Array.from(decades).sort((a, b) => b.localeCompare(a));
  }, [alumni]);

  const getAlumniDecade = (year: number | null) => (
    year ? `${Math.floor(year / 10) * 10}s` : "Unknown"
  );

  // Filter and group alumni by decade
  const alumniSections = useMemo(() => {
    let filtered = alumni;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = alumni.filter((a) => {
        const name = `${a.first_name || ""} ${a.last_name || ""}`.toLowerCase();
        const company = a.current_company?.toLowerCase() || "";
        return name.includes(query) || company.includes(query);
      });
    }

    if (alumniDecadeFilter !== "all") {
      filtered = filtered.filter(
        (a) => getAlumniDecade(a.graduation_year ?? null) === alumniDecadeFilter
      );
    }

    // Group by decade
    const decades = new Map<string, typeof filtered>();
    filtered.forEach((a) => {
      const decade = getAlumniDecade(a.graduation_year ?? null);
      if (!decades.has(decade)) {
        decades.set(decade, []);
      }
      decades.get(decade)!.push(a);
    });

    // Sort decades descending
    return Array.from(decades.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([decade, data]) => ({
        title: decade,
        data: [...data].sort((a, b) => {
          const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
          const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
          return nameA.localeCompare(nameB);
        }),
      }));
  }, [alumni, searchQuery, alumniDecadeFilter]);

  const filtersActive =
    (activeTab === "members" || !canViewAlumni)
      ? roleFilter !== "all"
      : alumniDecadeFilter !== "all";

  const loading = membersLoading || (canViewAlumni && alumniLoading) || roleLoading;
  const error = membersError || (canViewAlumni && alumniError);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchMembersIfStale();
      if (canViewAlumni) {
        refetchAlumniIfStale();
      }
    }, [refetchMembersIfStale, refetchAlumniIfStale, canViewAlumni])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      refetchMembers();
      if (canViewAlumni) {
        await refetchAlumni();
      }
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetchMembers, refetchAlumni, canViewAlumni]);

  const getMemberInitials = (member: (typeof members)[0]) => {
    const name = member.user?.name;
    if (name) {
      const parts = name.split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name[0]?.toUpperCase() || "?";
    }
    return member.user?.email?.[0]?.toUpperCase() || "?";
  };

  const getAlumniInitials = (a: (typeof alumni)[0]) => {
    const first = a.first_name?.[0] || "";
    const last = a.last_name?.[0] || "";
    return (first + last).toUpperCase() || "?";
  };

  const renderMemberItem = ({ item }: { item: (typeof members)[0] }) => {
    const role = normalizeRole(item.role as UserRole | null);
    const { isAdmin } = roleFlags(role);

    return (
      <TouchableOpacity 
        style={styles.personCard} 
        activeOpacity={0.7}
        onPress={() => router.push(`/(app)/${orgSlug}/members/${item.id}`)}
      >
        {item.user?.avatar_url ? (
          <Image source={{ uri: item.user.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{getMemberInitials(item)}</Text>
          </View>
        )}
        <View style={styles.personInfo}>
          <Text style={styles.personName} numberOfLines={1}>
            {item.user?.name || item.user?.email || "Unknown"}
          </Text>
          <Text style={styles.personDetail}>{isAdmin ? "Admin" : "Member"}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderAlumniItem = ({ item }: { item: (typeof alumni)[0] }) => {
    const name = [item.first_name, item.last_name].filter(Boolean).join(" ") || "Unknown";
    const detail = [item.graduation_year, item.current_company].filter(Boolean).join(" · ");

    return (
      <TouchableOpacity style={styles.personCard} activeOpacity={0.7}>
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{getAlumniInitials(item)}</Text>
          </View>
        )}
        <View style={styles.personInfo}>
          <Text style={styles.personName} numberOfLines={1}>{name}</Text>
          <Text style={styles.personDetail} numberOfLines={1}>{detail || "Alumni"}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  const renderEmptyMembers = () => (
    <View style={styles.emptyContainer}>
      <Users size={48} color={colors.mutedForeground} />
      <Text style={styles.emptyTitle}>No members found</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery ? "Try a different search" : "Members will appear here"}
      </Text>
    </View>
  );

  const renderEmptyAlumni = () => (
    <View style={styles.emptyContainer}>
      <GraduationCap size={48} color={colors.mutedForeground} />
      <Text style={styles.emptyTitle}>No alumni found</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery ? "Try a different search" : "Alumni will appear here"}
      </Text>
    </View>
  );

  if (loading && members.length === 0 && alumni.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name..."
            placeholderTextColor={colors.mutedForeground}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity
          style={[styles.filterButton, filtersActive && styles.filterButtonActive]}
          onPress={() => setFiltersVisible((prev) => !prev)}
          activeOpacity={0.8}
        >
          <SlidersHorizontal size={20} color={filtersActive ? colors.primary : colors.muted} />
          {filtersActive && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {filtersVisible && (
        <View style={styles.filterPanel}>
          {activeTab === "members" || !canViewAlumni ? (
            <View style={styles.filterSection}>
              <Text style={styles.filterLabel}>Role</Text>
              <View style={styles.filterChipRow}>
                {[
                  { value: "all", label: "All" },
                  { value: "admin", label: "Admins" },
                  { value: "member", label: "Members" },
                ].map((option) => {
                  const selected = roleFilter === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => setRoleFilter(option.value as "all" | "admin" | "member")}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={styles.filterSection}>
              <Text style={styles.filterLabel}>Graduation</Text>
              <View style={styles.filterChipRow}>
                <Pressable
                  onPress={() => setAlumniDecadeFilter("all")}
                  style={[styles.filterChip, alumniDecadeFilter === "all" && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, alumniDecadeFilter === "all" && styles.filterChipTextActive]}>
                    All
                  </Text>
                </Pressable>
                {alumniDecades.map((decade) => {
                  const selected = alumniDecadeFilter === decade;
                  return (
                    <Pressable
                      key={decade}
                      onPress={() => setAlumniDecadeFilter(decade)}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>
                        {decade}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.filterActions}>
            <TouchableOpacity
              onPress={() => {
                setRoleFilter("all");
                setAlumniDecadeFilter("all");
              }}
              style={styles.filterActionButton}
            >
              <Text style={styles.filterActionText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFiltersVisible(false)}
              style={[styles.filterActionButton, styles.filterActionPrimary]}
            >
              <Text style={[styles.filterActionText, styles.filterActionTextPrimary]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Tab Switcher - Only show if alumni tab is accessible */}
      {canViewAlumni && (
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={styles.tab}
            onPress={() => handleTabChange("members")}
          >
            <Text style={[styles.tabText, activeTab === "members" && styles.tabTextActive]}>
              Members
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tab}
            onPress={() => handleTabChange("alumni")}
          >
            <Text style={[styles.tabText, activeTab === "alumni" && styles.tabTextActive]}>
              Alumni
            </Text>
          </TouchableOpacity>
          <Animated.View style={[styles.tabIndicator, indicatorStyle]} />
        </View>
      )}

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      )}

      {/* Content */}
      {activeTab === "members" || !canViewAlumni ? (
        <FlatList
          data={filteredMembers}
          keyExtractor={(item) => item.id}
          renderItem={renderMemberItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyMembers}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        />
      ) : (
        <SectionList
          sections={alumniSections}
          keyExtractor={(item) => item.id}
          renderItem={renderAlumniItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyAlumni}
          stickySectionHeadersEnabled
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: colors.foreground,
  },
  filterButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.card,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  filterButtonActive: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  filterDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  filterPanel: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderCurve: "continuous",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  filterSection: {
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  filterChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  filterChipText: {
    fontSize: 13,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  filterChipTextActive: {
    color: colors.primaryForeground,
    fontWeight: fontWeight.semibold,
  },
  filterActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  filterActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterActionPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterActionText: {
    fontSize: 14,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  filterActionTextPrimary: {
    color: colors.primaryForeground,
  },
  tabContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 8,
    position: "relative",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 16,
    width: SCREEN_WIDTH / 2 - 32,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 40,
    flexGrow: 1,
  },
  personCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    padding: 12,
    borderRadius: 12,
    borderCurve: "continuous",
    marginBottom: 8,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primaryDark,
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
  personDetail: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  sectionHeader: {
    backgroundColor: colors.background,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.foreground,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: 4,
  },
  errorContainer: {
    backgroundColor: `${colors.error}20`,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 4,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: "500",
  },
  });
