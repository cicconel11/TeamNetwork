import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
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
import { colors, spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

type TabType = "members" | "alumni";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function MembersScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { permissions, isLoading: roleLoading } = useOrgRole();
  const canViewAlumni = permissions.canViewAlumni;
  
  const { members, loading: membersLoading, error: membersError, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgSlug || "");
  // Only fetch alumni data if the user has permission to view it
  const { alumni, loading: alumniLoading, error: alumniError, refetch: refetchAlumni, refetchIfStale: refetchAlumniIfStale } = useAlumni(canViewAlumni ? (orgSlug || "") : "");

  const [activeTab, setActiveTab] = useState<TabType>("members");
  const [searchQuery, setSearchQuery] = useState("");
  const tabIndicatorPosition = useSharedValue(0);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);

  const handleTabChange = useCallback((tab: TabType) => {
    // Only allow switching to alumni tab if user has permission
    if (tab === "alumni" && !canViewAlumni) return;
    setActiveTab(tab);
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

  // Filter members by search
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter((member) => {
      const name = member.user?.name?.toLowerCase() || "";
      const email = member.user?.email?.toLowerCase() || "";
      return name.includes(query) || email.includes(query);
    });
  }, [members, searchQuery]);

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

    // Group by decade
    const decades = new Map<string, typeof filtered>();
    filtered.forEach((a) => {
      const year = a.graduation_year;
      const decade = year ? `${Math.floor(year / 10) * 10}s` : "Unknown";
      if (!decades.has(decade)) {
        decades.set(decade, []);
      }
      decades.get(decade)!.push(a);
    });

    // Sort decades descending
    return Array.from(decades.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([decade, data]) => ({ title: decade, data }));
  }, [alumni, searchQuery]);

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
      <Users size={48} color="#9ca3af" />
      <Text style={styles.emptyTitle}>No members found</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery ? "Try a different search" : "Members will appear here"}
      </Text>
    </View>
  );

  const renderEmptyAlumni = () => (
    <View style={styles.emptyContainer}>
      <GraduationCap size={48} color="#9ca3af" />
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
          <Search size={20} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        <TouchableOpacity style={styles.filterButton}>
          <SlidersHorizontal size={20} color="#666" />
        </TouchableOpacity>
      </View>

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

const styles = StyleSheet.create({
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
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: "#1a1a1a",
  },
  filterButton: {
    width: 44,
    height: 44,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "#ffffff",
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
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4f46e5",
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  personDetail: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  sectionHeader: {
    backgroundColor: "#f5f5f5",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
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
    color: "#1a1a1a",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  errorContainer: {
    backgroundColor: "#fee2e2",
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 4,
  },
  errorText: {
    fontSize: 12,
    color: "#991b1b",
    fontWeight: "500",
  },
});
