import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Alert,
  RefreshControl,
  Pressable,
  Linking,
} from "react-native";
import * as Application from "expo-application";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { getWebAppUrl } from "@/lib/web-api";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import {
  Bell,
  BookOpen,
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
import { supabase, signOut } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

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
  const navigation = useNavigation();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);
  const lastFetchTimeRef = useRef<number>(0);

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
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    accountBlock: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      marginBottom: SPACING.lg,
      borderWidth: 1,
      borderColor: n.border,
      ...SHADOWS.sm,
    },
    orgRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingBottom: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    orgInfo: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flex: 1,
    },
    orgLogoSmall: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.md,
      marginRight: SPACING.sm,
    },
    orgLogoPlaceholder: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.md,
      backgroundColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginRight: SPACING.sm,
    },
    orgName: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
    },
    switchButton: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      backgroundColor: n.background,
      borderRadius: RADIUS.sm,
    },
    switchButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.success,
    },
    profileRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingTop: SPACING.md,
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
      backgroundColor: s.successLight,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarInitials: {
      ...TYPOGRAPHY.titleMedium,
      fontWeight: "600" as const,
      color: s.successDark,
    },
    profileInfo: {
      flex: 1,
      marginLeft: SPACING.sm,
    },
    profileName: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    profileEdit: {
      ...TYPOGRAPHY.bodySmall,
      color: s.success,
      marginTop: 2,
    },
    section: {
      marginBottom: SPACING.lg,
    },
    sectionTitle: {
      ...TYPOGRAPHY.overline,
      color: n.muted,
      marginBottom: SPACING.sm,
      marginLeft: SPACING.xs,
    },
    menuCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      ...SHADOWS.sm,
    },
    menuItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      padding: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    menuItemLeft: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      flex: 1,
    },
    menuItemLabel: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
      marginLeft: SPACING.sm,
    },
    menuItemRight: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    badge: {
      backgroundColor: s.error,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingHorizontal: 6,
    },
    badgeText: {
      ...TYPOGRAPHY.labelSmall,
      color: "#ffffff",
    },
    errorContainer: {
      backgroundColor: s.errorLight,
      borderLeftWidth: 4,
      borderLeftColor: s.error,
      padding: SPACING.sm,
      marginBottom: SPACING.md,
      borderRadius: RADIUS.xs,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
      fontWeight: "500" as const,
      marginBottom: SPACING.sm,
    },
    retryButton: {
      backgroundColor: s.error,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.sm,
      alignSelf: "flex-start" as const,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
  }));

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
            await signOut();
            router.replace("/(auth)");
          },
        },
      ]
    );
  };

  const handleSwitchOrg = () => {
    router.replace({
      pathname: "/(app)",
      params: { currentSlug: orgSlug },
    });
  };

  const renderMenuItem = (item: MenuItem) => (
    <Pressable
      key={item.label}
      style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.7 }]}
      onPress={item.onPress}
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
          <ChevronRight size={20} color={neutral.secondary} />
        )}
      </View>
    </Pressable>
  );

  const updatesItems: MenuItem[] = [
    {
      icon: <Bell size={20} color={neutral.muted} />,
      label: "Notifications",
      onPress: () => router.push(`/(app)/${orgSlug}/notifications`),
      badge: notificationCount,
    },
  ];

  // Build community items based on feature flags
  const communityItems: MenuItem[] = [
    {
      icon: <BookOpen size={20} color={neutral.muted} />,
      label: "Schedules",
      onPress: () => router.push(`/(app)/${orgSlug}/schedules`),
    },
  ];

  if (permissions.canViewDonations) {
    communityItems.push({
      icon: <Heart size={20} color={neutral.muted} />,
      label: "Donations",
      onPress: () => router.push(`/(app)/${orgSlug}/donations`),
    });
  }

  if (permissions.canViewRecords) {
    communityItems.push({
      icon: <Trophy size={20} color={neutral.muted} />,
      label: "Records",
      onPress: () => router.push(`/(app)/${orgSlug}/records`),
    });
  }

  if (permissions.canViewForms) {
    communityItems.push({
      icon: <FileText size={20} color={neutral.muted} />,
      label: "Forms",
      onPress: () => router.push(`/(app)/${orgSlug}/forms`),
    });
  }

  const adminItems: MenuItem[] = [
    {
      icon: <Settings size={20} color={neutral.muted} />,
      label: "Settings",
      onPress: () => router.push(`/(app)/${orgSlug}/settings`),
    },
    {
      icon: <UserPlus size={20} color={neutral.muted} />,
      label: "Invites",
      onPress: () => router.push(`/(app)/${orgSlug}/invites`),
    },
    {
      icon: <CreditCard size={20} color={neutral.muted} />,
      label: "Billing",
      onPress: () => router.push(`/(app)/${orgSlug}/billing`),
    },
  ];

  const handleAbout = () => {
    const version = Application.nativeApplicationVersion || "1.0.0";
    const buildNumber = Application.nativeBuildVersion || "1";
    Alert.alert(
      "About TeamMeet",
      `Version ${version} (${buildNumber})\n\nTeamMeet helps teams stay connected and organized.`,
      [
        { text: "OK", style: "default" },
        {
          text: "Learn More",
          onPress: () => Linking.openURL(`${getWebAppUrl()}/about`),
        },
      ]
    );
  };

  const appItems: MenuItem[] = [
    {
      icon: <HelpCircle size={20} color={neutral.muted} />,
      label: "Help & Support",
      onPress: () => Linking.openURL(`${getWebAppUrl()}/help`),
    },
    {
      icon: <Info size={20} color={neutral.muted} />,
      label: "About TeamMeet",
      onPress: handleAbout,
    },
    {
      icon: <FileText size={20} color={neutral.muted} />,
      label: "Terms of Service",
      onPress: () => router.push("/(app)/terms"),
    },
    {
      icon: <LogOut size={20} color={semantic.error} />,
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
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {organization?.logo_url ? (
                <Image source={organization.logo_url} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{organization?.name?.[0] || "?"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Menu</Text>
              <Text style={styles.headerMeta}>{organization?.name || "Organization"}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={semantic.success}
            />
          }
        >
          {/* Error Display */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Error: {error}</Text>
              <Pressable style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]} onPress={handleRefresh}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Account Block */}
          <View style={styles.accountBlock}>
            {/* Organization */}
            <View style={styles.orgRow}>
              <View style={styles.orgInfo}>
                {organization?.logo_url ? (
                  <Image source={organization.logo_url} style={styles.orgLogoSmall} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgLogoPlaceholder}>
                    <Building2 size={20} color={neutral.muted} />
                  </View>
                )}
                <Text style={styles.orgName} numberOfLines={1}>
                  {organization?.name || "Organization"}
                </Text>
              </View>
              <Pressable style={({ pressed }) => [styles.switchButton, pressed && { opacity: 0.7 }]} onPress={handleSwitchOrg}>
                <Text style={styles.switchButtonText}>Switch</Text>
              </Pressable>
            </View>

            {/* User Profile */}
            <Pressable
              style={({ pressed }) => [styles.profileRow, pressed && { opacity: 0.7 }]}
              onPress={() =>
                router.push({
                  pathname: "/(app)/(drawer)/profile",
                  params: { currentSlug: orgSlug },
                } as any)
              }
            >
              {userAvatar ? (
                <Image source={userAvatar} style={styles.avatar} contentFit="cover" transition={200} />
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
              <ChevronRight size={20} color={neutral.secondary} />
            </Pressable>
          </View>

          {/* Updates Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Updates</Text>
            <View style={styles.menuCard}>
              {updatesItems.map(renderMenuItem)}
            </View>
          </View>

          {/* Community Section - Only show if there are enabled features */}
          {communityItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Community</Text>
              <View style={styles.menuCard}>
                {communityItems.map(renderMenuItem)}
              </View>
            </View>
          )}

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
    </View>
  );
}
