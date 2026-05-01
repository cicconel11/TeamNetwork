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
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { spacing, fontSize, fontWeight } from "@/lib/theme";
import { NEUTRAL, SEMANTIC, RADIUS } from "@/lib/design-tokens";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Settings;
  openInWeb?: boolean;
}

interface NavSection {
  id: string;
  title: string | null; // null = no header
  items: NavItem[];
}

// Pinned footer items (Settings, Navigation, Organizations, Sign Out) — Delete Account is under profile in scroll
const PINNED_ITEM_HEIGHT = 44;
const PINNED_FOOTER_COUNT = 4;
const FOOTER_PADDING = 16;
/** Pinned strip (wordmark) + divider margins — keeps scroll clear of fixed footer */
const BRAND_STRIP_HEIGHT = 104;
const FOOTER_HEIGHT =
  BRAND_STRIP_HEIGHT +
  PINNED_ITEM_HEIGHT * PINNED_FOOTER_COUNT +
  FOOTER_PADDING;

export function DrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { orgSlug } = useGlobalSearchParams<{ orgSlug?: string }>();
  const { user } = useAuth();
  const { permissions, role } = useOrgRole();
  const { orgName, orgLogoUrl, hasParentsAccess } = useOrg();
  const slug = typeof orgSlug === "string" ? orgSlug : "";
  const orgInitial = (orgName ?? slug ?? "").trim().charAt(0).toUpperCase() || "O";
  const userMeta = (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string };
  const displayName = userMeta.name || user?.email || "Member";
  const displayEmail = user?.email || "";
  const isAppleRelayEmail = /@privaterelay\.appleid\.com$/i.test(displayEmail);
  const avatarUrl = userMeta.avatar_url || "";
  const initial = displayName.trim().charAt(0).toUpperCase() || "M";

  // Build sections for grouped navigation
  const sections = useMemo<NavSection[]>(() => {
    if (!slug) {
      // No org context - only show Organizations
      return [
        {
          id: "main",
          title: null,
          items: [{ label: "Organizations", href: "/(app)", icon: Building2 }],
        },
      ];
    }

    // Main section (no header): Home, Chat, Alumni*, Mentorship
    const mainItems: NavItem[] = [
      { label: "Home", href: `/(app)/${slug}`, icon: Home },
      { label: "Chat", href: `/(app)/${slug}/chat`, icon: MessageCircle },
    ];

    if (
      hasParentsAccess &&
      (role === "admin" || role === "active_member" || role === "parent")
    ) {
      mainItems.push({ label: "Parents", href: `/(app)/${slug}/parents`, icon: Users });
    }

    if (permissions.canViewAlumni) {
      mainItems.push({ label: "Alumni", href: `/(app)/${slug}/alumni`, icon: GraduationCap });
    }

    mainItems.push({ label: "Mentorship", href: `/(app)/${slug}/mentorship`, icon: Handshake });

    // Training section
    const trainingItems: NavItem[] = [
      { label: "Workouts", href: `/(app)/${slug}/workouts`, icon: Dumbbell },
      { label: "Competition", href: `/(app)/${slug}/competition`, icon: Award },
      { label: "Records", href: `/(app)/${slug}/records`, icon: Trophy },
    ];

    // Money section
    const moneyItems: NavItem[] = [
      { label: "Philanthropy", href: `/(app)/${slug}/philanthropy`, icon: Heart },
      { label: "Donations", href: `/(app)/${slug}/donations`, icon: DollarSign },
      { label: "Expenses", href: `/(app)/${slug}/expenses`, icon: Receipt },
    ];

    // Other section
    const otherItems: NavItem[] = [
      { label: "Forms", href: `/(app)/${slug}/forms`, icon: ClipboardList },
    ];

    // Community section
    const communityItems: NavItem[] = [
      {
        label: "Jobs",
        icon: Briefcase,
        href: `/(app)/${slug}/jobs`,
      },
    ];

    const sections: NavSection[] = [
      { id: "main", title: null, items: mainItems },
    ];

    if (communityItems.length > 0) {
      sections.push({ id: "community", title: "Community", items: communityItems });
    }

    sections.push(
      { id: "training", title: "Training", items: trainingItems },
      { id: "money", title: "Money", items: moneyItems },
      { id: "other", title: "Other", items: otherItems },
    );

    return sections;
  }, [slug, permissions.canViewAlumni, hasParentsAccess, role]);

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
        <Icon size={18} color={isDangerous ? SEMANTIC.error : NEUTRAL.placeholder} />
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
          { paddingTop: topInset + spacing.md, paddingBottom: FOOTER_HEIGHT + bottomInset },
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

        {/* Sections */}
        {sections.map((section) => (
          <View key={section.id} style={styles.section}>
            {section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : null}
            {section.items.map((item) => renderNavItem(item))}
          </View>
        ))}
      </DrawerContentScrollView>

      {/* Pinned: TeamNetwork (always visible) + settings / account — does not scroll */}
      <View style={[styles.pinnedFooter, { paddingBottom: bottomInset }]}>
        <View style={styles.brandPinned}>
          <View style={styles.brandLogoFrame}>
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
        <View style={styles.divider} />
        {slug ? pinnedItems.map((item) => renderNavItem(item)) : null}
        {renderNavItem({ label: "Sign Out", href: "", icon: LogOut }, { isSignOut: true, isDangerous: true })}
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
    paddingBottom: spacing.sm,
  },
  orgIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  orgLogoContainer: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    borderCurve: "continuous",
    backgroundColor: NEUTRAL.dark800,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  orgLogoImage: {
    width: 40,
    height: 40,
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
  /** Pinned footer strip — wordmark stays on screen while nav scrolls */
  brandPinned: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    width: "100%" as const,
    backgroundColor: NEUTRAL.dark950,
  },
  /** Fixed frame so Expo Image lays out at full size on web + native (avoids tiny absolute img) */
  brandLogoFrame: {
    width: "100%" as const,
    maxWidth: 288,
    height: 72,
    minHeight: 72,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    alignSelf: "center" as const,
  },
  brandLogoInline: {
    width: "100%" as const,
    height: "100%" as const,
    maxHeight: 72,
    opacity: 0.68,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
  },
  section: {
    gap: 2,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: NEUTRAL.placeholder,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 44,
    paddingHorizontal: spacing.md,
  },
  navItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  navItemPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  navLabel: {
    fontSize: 15,
    fontWeight: fontWeight.medium,
    color: NEUTRAL.surface,
  },
  signOutLabel: {
    color: SEMANTIC.error,
  },
  pinnedFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: NEUTRAL.dark950,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.09)",
    boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.35)",
  },
});
