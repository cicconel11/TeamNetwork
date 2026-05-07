import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from "@react-navigation/drawer";
import { useGlobalSearchParams, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import {
  Award,
  Briefcase,
  Building2,
  ClipboardList,
  DollarSign,
  Dumbbell,
  GraduationCap,
  Heart,
  Handshake,
  Home,
  LogOut,
  MessageCircle,
  Receipt,
  Settings,
  SlidersHorizontal,
  Trophy,
  Users,
} from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useNavConfig } from "@/hooks/useNavConfig";
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { spacing, fontSize, fontWeight } from "@/lib/theme";
import { NEUTRAL, SEMANTIC, RADIUS } from "@/lib/design-tokens";
import { Bell, Calendar, Megaphone } from "lucide-react-native";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Settings;
  openInWeb?: boolean;
  configKey?: string; // matches nav_config key (slug after `/${slug}`)
}

// Pinned footer items (Settings, Navigation, Organizations, Sign Out)
const PINNED_ITEM_HEIGHT = 48;
const PINNED_FOOTER_COUNT = 4;
const BRAND_STRIP_HEIGHT = 88;
const FOOTER_PADDING = 32;
const FOOTER_TOP_INSET = 8;
const FOOTER_HEIGHT =
  PINNED_ITEM_HEIGHT * PINNED_FOOTER_COUNT +
  BRAND_STRIP_HEIGHT +
  FOOTER_TOP_INSET +
  FOOTER_PADDING;

export function DrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { orgSlug } = useGlobalSearchParams<{ orgSlug?: string }>();
  const { user } = useAuth();
  const { permissions, role } = useOrgRole();
  const { orgName, orgLogoUrl, hasParentsAccess, orgId } = useOrg();
  const { navConfig } = useNavConfig(orgId);
  const slug = typeof orgSlug === "string" ? orgSlug : "";
  const orgInitial = (orgName ?? slug ?? "").trim().charAt(0).toUpperCase() || "O";
  const userMeta = (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string };
  const displayName = userMeta.name || user?.email || "Member";
  const displayEmail = user?.email || "";
  const isAppleRelayEmail = /@privaterelay\.appleid\.com$/i.test(displayEmail);
  const avatarUrl = userMeta.avatar_url || "";
  const initial = displayName.trim().charAt(0).toUpperCase() || "M";

  // Build sections for grouped navigation
  const items = useMemo<NavItem[]>(() => {
    if (!slug) {
      return [{ label: "Organizations", href: "/(app)", icon: Building2 }];
    }

    const all: NavItem[] = [
      { label: "Home", href: `/(app)/${slug}`, icon: Home, configKey: "dashboard" },
      { label: "Chat", href: `/(app)/${slug}/chat`, icon: MessageCircle, configKey: "/chat" },
      { label: "Members", href: `/(app)/${slug}/members`, icon: Users, configKey: "/members" },
      { label: "Parents", href: `/(app)/${slug}/parents`, icon: Users, configKey: "/parents" },
      { label: "Alumni", href: `/(app)/${slug}/alumni`, icon: GraduationCap, configKey: "/alumni" },
      { label: "Mentorship", href: `/(app)/${slug}/mentorship`, icon: Handshake, configKey: "/mentorship" },
      { label: "Events", href: `/(app)/${slug}/events`, icon: Calendar, configKey: "/events" },
      { label: "Announcements", href: `/(app)/${slug}/announcements`, icon: Megaphone, configKey: "/announcements" },
      { label: "Jobs", href: `/(app)/${slug}/jobs`, icon: Briefcase, configKey: "/jobs" },
      { label: "Workouts", href: `/(app)/${slug}/workouts`, icon: Dumbbell, configKey: "/workouts" },
      { label: "Competition", href: `/(app)/${slug}/competition`, icon: Award, configKey: "/competition" },
      { label: "Records", href: `/(app)/${slug}/records`, icon: Trophy, configKey: "/records" },
      { label: "Schedules", href: `/(app)/${slug}/schedules`, icon: ClipboardList, configKey: "/schedules" },
      { label: "Philanthropy", href: `/(app)/${slug}/philanthropy`, icon: Heart, configKey: "/philanthropy" },
      { label: "Donations", href: `/(app)/${slug}/donations`, icon: DollarSign, configKey: "/donations" },
      { label: "Expenses", href: `/(app)/${slug}/expenses`, icon: Receipt, configKey: "/expenses" },
      { label: "Forms", href: `/(app)/${slug}/forms`, icon: ClipboardList, configKey: "/forms" },
    ];

    const roleFiltered = all.filter((item) => {
      if (item.configKey === "/parents") {
        return (
          hasParentsAccess &&
          (role === "admin" || role === "active_member" || role === "parent")
        );
      }
      if (item.configKey === "/alumni") return permissions.canViewAlumni;
      return true;
    });

    const visible = roleFiltered.filter((item) => {
      if (!item.configKey) return true;
      const cfg = navConfig[item.configKey];
      if (!cfg) return true;
      if (cfg.hidden) return false;
      if (role && cfg.hiddenForRoles?.includes(role as any)) return false;
      return true;
    });

    const withLabels = visible.map((item) => {
      const cfg = item.configKey ? navConfig[item.configKey] : undefined;
      return cfg?.label ? { ...item, label: cfg.label } : item;
    });

    const indexed = withLabels.map((item, idx) => ({ item, idx }));
    indexed.sort((a, b) => {
      const oa = a.item.configKey ? navConfig[a.item.configKey]?.order : undefined;
      const ob = b.item.configKey ? navConfig[b.item.configKey]?.order : undefined;
      if (oa != null && ob != null) return oa - ob;
      if (oa != null) return -1;
      if (ob != null) return 1;
      return a.idx - b.idx;
    });

    return indexed.map((x) => x.item);
  }, [slug, permissions.canViewAlumni, hasParentsAccess, role, navConfig]);

  // Pinned footer items
  const pinnedItems = useMemo<NavItem[]>(() => {
    if (!slug) return [];
    return [
      { label: "Settings", href: `/(app)/${slug}/settings`, icon: Settings },
      { label: "Navigation", href: `/(app)/${slug}/settings/navigation`, icon: SlidersHorizontal },
      { label: "Organizations", href: "/(app)", icon: Building2 },
    ];
  }, [slug]);

  const handleNavigate = (item: NavItem) => {
    props.navigation.closeDrawer();
    if (item.openInWeb) {
      const baseUrl = getWebAppUrl().replace(/\/$/, "");
      void Linking.openURL(`${baseUrl}${item.href}`);
      return;
    }
    // Use push for Home to preserve back navigation within org
    // Use navigate for Organizations to reset navigation state (avoids "[orgSlug]" back button)
    // Use replace for secondary screens to avoid stacking
    if (item.href === `/(app)/${slug}`) {
      router.push(item.href);
    } else if (item.href === "/(app)/(drawer)/delete-account") {
      router.push({
        pathname: item.href as any,
        params: slug ? { currentSlug: slug } : undefined,
      } as any);
    } else if (item.href === "/(app)") {
      router.navigate({
        pathname: item.href as any,
        params: slug ? { currentSlug: slug } : undefined,
      } as any);
    } else {
      router.replace(item.href);
    }
  };

  const handleSignOut = async () => {
    props.navigation.closeDrawer();
    await signOut();
  };

  // Check if a route is active
  const isRouteActive = (href: string) => {
    // usePathname() returns paths WITHOUT route group segments like (app) or (drawer)
    // Our hrefs include /(app)/ so we need to strip that prefix for comparison
    // e.g., href "/(app)/myorg/home" -> "/myorg/home" to match pathname "/myorg/home"
    const normalizedHref = href.replace(/^\/\(app\)/, "");
    const normalizedPathname = pathname;

    if (normalizedHref === normalizedPathname) return true;
    // Check if pathname starts with href (for nested routes)
    if (normalizedHref && normalizedPathname.startsWith(normalizedHref + "/")) return true;
    return false;
  };

  const renderNavItem = (
    item: NavItem,
    options: { isSignOut?: boolean; isDangerous?: boolean } = {}
  ) => {
    const { isSignOut = false, isDangerous = false } = options;
    const Icon = item.icon;
    const isActive = !isSignOut && !isDangerous && isRouteActive(item.href);

    return (
      <Pressable
        key={item.label}
        accessibilityRole="button"
        onPress={isSignOut ? handleSignOut : () => handleNavigate(item)}
        style={({ pressed }) => [
          styles.navItem,
          isActive && styles.navItemActive,
          pressed && styles.navItemPressed,
        ]}
      >
        <Icon size={22} color={isDangerous ? SEMANTIC.error : NEUTRAL.placeholder} strokeWidth={1.8} />
        <Text style={[styles.navLabel, isDangerous && styles.signOutLabel]}>{item.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Scrollable content */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + spacing.md, paddingBottom: FOOTER_HEIGHT + bottomInset + spacing.lg },
        ]}
        scrollEnabled
      >
        {/* Drawer header: org identity only */}
        {slug ? (
          <View style={styles.drawerHeader}>
            <View style={styles.orgIdentityRow}>
              <View style={styles.orgLogoContainer}>
                {orgLogoUrl ? (
                  <Image
                    source={orgLogoUrl}
                    style={styles.orgLogoImage}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <Text style={styles.orgLogoFallback}>{orgInitial}</Text>
                )}
              </View>
              {orgName ? (
                <Text style={styles.orgName} numberOfLines={1}>
                  {orgName}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {/* Profile Card */}
        <Pressable
          style={({ pressed }) => [styles.profileCard, pressed && styles.profileCardPressed]}
          onPress={() => {
            props.navigation.closeDrawer();
            router.push({
              pathname: "/(app)/(drawer)/profile",
              params: slug ? { currentSlug: slug } : undefined,
            } as any);
          }}
        >
          <View style={styles.avatar}>
            {avatarUrl ? (
              <Image source={avatarUrl} style={styles.avatarImage} contentFit="cover" transition={200} />
            ) : (
              <Text style={styles.avatarFallback}>{initial}</Text>
            )}
          </View>
          <View style={styles.profileMeta}>
            <Text style={styles.profileName}>{displayName}</Text>
            {displayEmail ? (
              <Text style={styles.profileEmail} numberOfLines={1} ellipsizeMode="tail">
                {displayEmail}
              </Text>
            ) : null}
            {isAppleRelayEmail ? (
              <View style={styles.relayBadge}>
                <Text style={styles.relayBadgeText}>Hidden by Apple</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.divider} />

        <View style={styles.section}>
          {items.map((item) => renderNavItem(item))}
        </View>

      </DrawerContentScrollView>

      {/* Pinned: settings / account — does not scroll */}
      <View style={[styles.pinnedFooter, { paddingBottom: bottomInset }]}>
        {slug ? pinnedItems.map((item) => renderNavItem(item)) : null}
        {renderNavItem({ label: "Sign Out", href: "", icon: LogOut }, { isSignOut: true, isDangerous: true })}
        <View style={styles.brandStrip}>
          <Text style={styles.brandPoweredBy}>Powered by</Text>
          <Image
            source={require("../../assets/brand-logo.png")}
            style={styles.brandLogoInline}
            contentFit="contain"
            transition={0}
            cachePolicy="memory"
            accessibilityLabel="TeamNetwork"
            accessibilityRole="image"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.dark950,
  },
  scrollContent: {
    // paddingTop is set dynamically with safe area inset
  },
  drawerHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  orgIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  orgLogoContainer: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: NEUTRAL.dark800,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  orgLogoImage: {
    width: 32,
    height: 32,
  },
  orgLogoFallback: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: NEUTRAL.surface,
  },
  orgName: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: NEUTRAL.surface,
  },
  brandStrip: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    height: BRAND_STRIP_HEIGHT,
    gap: 4,
  },
  brandPoweredBy: {
    fontSize: 11,
    color: NEUTRAL.placeholder,
    letterSpacing: 0.4,
    opacity: 0.7,
  },
  brandLogoInline: {
    width: 180,
    height: 44,
    opacity: 0.9,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  profileCardPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: NEUTRAL.dark900,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 44,
    height: 44,
  },
  avatarFallback: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: NEUTRAL.surface,
  },
  profileMeta: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: NEUTRAL.surface,
  },
  profileEmail: {
    marginTop: 2,
    fontSize: fontSize.sm,
    color: NEUTRAL.placeholder,
  },
  relayBadge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  relayBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: NEUTRAL.placeholder,
    letterSpacing: 0.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  section: {
    paddingHorizontal: spacing.sm,
    gap: 0,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    borderCurve: "continuous",
  },
  navItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  navItemPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  navLabel: {
    fontSize: 17,
    fontWeight: fontWeight.medium,
    color: NEUTRAL.surface,
    letterSpacing: -0.2,
  },
  signOutLabel: {
    color: SEMANTIC.error,
  },
  pinnedFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    backgroundColor: NEUTRAL.dark950,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    boxShadow: "0 -1px 0 rgba(255, 255, 255, 0.06)",
  },
});
