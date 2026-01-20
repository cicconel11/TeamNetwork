import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useOrg } from "@/contexts/OrgContext";
import {
  Bell,
  Heart,
  Trophy,
  FileText,
  Settings,
  UserPlus,
  CreditCard,
  HelpCircle,
  Info,
  LogOut,
  ChevronRight,
  Building2,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRole, roleFlags } from "@teammeet/core";

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

interface MenuItem {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  badge?: number;
  showChevron?: boolean;
}

const STALE_TIME_MS = 30_000; // 30 seconds

export default function MenuScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { user } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);
  const lastFetchTimeRef = useRef<number>(0);

  const fetchData = useCallback(async () => {
    if (!user || !orgSlug) return;

    try {
      setError(null);

      // Fetch organization
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url")
        .eq("slug", orgSlug)
        .single();

      if (orgError) throw orgError;
      if (!orgData) throw new Error("Organization not found");

      setOrganization(orgData);

      // Fetch user role and profile
      const { data: roleData, error: roleError } = await supabase
        .from("user_organization_roles")
        .select("role, user:users(name, avatar_url)")
        .eq("user_id", user.id)
        .eq("organization_id", orgData.id)
        .eq("status", "active")
        .single();

      if (roleError) throw roleError;

      if (roleData) {
        const normalized = normalizeRole(roleData.role);
        const flags = roleFlags(normalized);
        setIsAdmin(flags.isAdmin);

        const userData = roleData.user as { name: string | null; avatar_url: string | null } | null;
        if (userData) {
          setUserName(userData.name);
          setUserAvatar(userData.avatar_url);
        }
      }

      // TODO: Fetch notification count when notifications are implemented
      setNotificationCount(0);
      lastFetchTimeRef.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user, orgSlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
        fetchData();
      }
    }, [fetchData])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await fetchData();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [fetchData]);

  const handleSignOut = async () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            await supabase.auth.signOut();
            router.replace("/(auth)");
          },
        },
      ]
    );
  };

  const handleSwitchOrg = () => {
    router.push("/(app)");
  };

  const renderMenuItem = (item: MenuItem) => (
    <TouchableOpacity
      key={item.label}
      style={styles.menuItem}
      onPress={item.onPress}
      activeOpacity={0.7}
    >
      <View style={styles.menuItemLeft}>
        {item.icon}
        <Text style={styles.menuItemLabel}>{item.label}</Text>
      </View>
      <View style={styles.menuItemRight}>
        {item.badge !== undefined && item.badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {item.badge > 9 ? "9+" : item.badge}
            </Text>
          </View>
        )}
        {item.showChevron !== false && (
          <ChevronRight size={20} color="#9ca3af" />
        )}
      </View>
    </TouchableOpacity>
  );

  const updatesItems: MenuItem[] = [
    {
      icon: <Bell size={20} color="#666" />,
      label: "Notifications",
      onPress: () => console.log("Notifications"),
      badge: notificationCount,
    },
  ];

  const communityItems: MenuItem[] = [
    {
      icon: <Heart size={20} color="#666" />,
      label: "Donations",
      onPress: () => console.log("Donations"),
    },
    {
      icon: <Trophy size={20} color="#666" />,
      label: "Records",
      onPress: () => console.log("Records"),
    },
    {
      icon: <FileText size={20} color="#666" />,
      label: "Forms",
      onPress: () => console.log("Forms"),
    },
  ];

  const adminItems: MenuItem[] = [
    {
      icon: <Settings size={20} color="#666" />,
      label: "Settings",
      onPress: () => router.push(`/(app)/${orgSlug}/settings`),
    },
    {
      icon: <UserPlus size={20} color="#666" />,
      label: "Invites",
      onPress: () => console.log("Invites"),
    },
    {
      icon: <CreditCard size={20} color="#666" />,
      label: "Billing",
      onPress: () => console.log("Billing"),
    },
  ];

  const appItems: MenuItem[] = [
    {
      icon: <HelpCircle size={20} color="#666" />,
      label: "Help & Support",
      onPress: () => console.log("Help"),
    },
    {
      icon: <Info size={20} color="#666" />,
      label: "About TeamMeet",
      onPress: () => console.log("About"),
    },
    {
      icon: <FileText size={20} color="#666" />,
      label: "Terms of Service",
      onPress: () => router.push("/(app)/terms"),
    },
    {
      icon: <LogOut size={20} color="#dc2626" />,
      label: "Sign Out",
      onPress: handleSignOut,
      showChevron: false,
    },
  ];

  const getInitials = (name: string | null, email: string | undefined) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return email?.charAt(0).toUpperCase() || "?";
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563eb"
          />
        }
      >
        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Account Block */}
        <View style={styles.accountBlock}>
          {/* Organization */}
          <View style={styles.orgRow}>
            <View style={styles.orgInfo}>
              {organization?.logo_url ? (
                <Image source={{ uri: organization.logo_url }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgLogoPlaceholder}>
                  <Building2 size={20} color="#666" />
                </View>
              )}
              <Text style={styles.orgName} numberOfLines={1}>
                {organization?.name || "Organization"}
              </Text>
            </View>
            <TouchableOpacity style={styles.switchButton} onPress={handleSwitchOrg}>
              <Text style={styles.switchButtonText}>Switch</Text>
            </TouchableOpacity>
          </View>

          {/* User Profile */}
          <TouchableOpacity style={styles.profileRow} activeOpacity={0.7}>
            {userAvatar ? (
              <Image source={{ uri: userAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>
                  {getInitials(userName, user?.email)}
                </Text>
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>
                {userName || user?.email?.split("@")[0] || "User"}
              </Text>
              <Text style={styles.profileEdit}>Edit Profile</Text>
            </View>
            <ChevronRight size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Updates Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Updates</Text>
          <View style={styles.menuCard}>
            {updatesItems.map(renderMenuItem)}
          </View>
        </View>

        {/* Community Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Community</Text>
          <View style={styles.menuCard}>
            {communityItems.map(renderMenuItem)}
          </View>
        </View>

        {/* Admin Section - Only show for admins */}
        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin</Text>
            <View style={styles.menuCard}>
              {adminItems.map(renderMenuItem)}
            </View>
          </View>
        )}

        {/* App Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.menuCard}>
            {appItems.map(renderMenuItem)}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  accountBlock: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    marginBottom: 24,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  orgInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  orgLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 12,
  },
  orgLogoPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  orgName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  switchButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#f5f5f5",
    borderRadius: 6,
  },
  switchButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#2563eb",
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e0e7ff",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2563eb",
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  profileEdit: {
    fontSize: 14,
    color: "#2563eb",
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  menuItemLabel: {
    fontSize: 16,
    color: "#1a1a1a",
    marginLeft: 12,
  },
  menuItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    backgroundColor: "#dc2626",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  errorContainer: {
    backgroundColor: "#fee2e2",
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
    padding: 12,
    marginBottom: 16,
    borderRadius: 4,
  },
  errorText: {
    fontSize: 14,
    color: "#991b1b",
    fontWeight: "500",
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
