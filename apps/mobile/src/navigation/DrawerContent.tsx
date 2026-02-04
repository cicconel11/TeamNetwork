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
  BookOpen,
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
} from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrgRole } from "@/hooks/useOrgRole";
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { spacing, fontSize, fontWeight } from "@/lib/theme";
import { NEUTRAL, SEMANTIC } from "@/lib/design-tokens";

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

// Pinned footer items (Settings, Navigation, Organizations, Sign Out)
const PINNED_ITEM_HEIGHT = 44;
const PINNED_FOOTER_COUNT = 4;
const FOOTER_PADDING = 16;
const FOOTER_HEIGHT = PINNED_ITEM_HEIGHT * PINNED_FOOTER_COUNT + FOOTER_PADDING;

export function DrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { orgSlug } = useGlobalSearchParams<{ orgSlug?: string }>();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const slug = typeof orgSlug === "string" ? orgSlug : "";
  const userMeta = (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string };
  const displayName = userMeta.name || user?.email || "Member";
  const displayEmail = user?.email || "";
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

    if (permissions.canViewAlumni) {
      mainItems.push({ label: "Alumni", href: `/(app)/${slug}/alumni`, icon: GraduationCap });
    }

    mainItems.push({ label: "Mentorship", href: `/(app)/${slug}/mentorship`, icon: Handshake });

    // Training section
    const trainingItems: NavItem[] = [
      { label: "Workouts", href: `/(app)/${slug}/workouts`, icon: Dumbbell },
      { label: "Competition", href: `/(app)/${slug}/competition`, icon: Award },
      { label: "Schedules", href: `/(app)/${slug}/schedules`, icon: BookOpen },
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

    return [
      { id: "main", title: null, items: mainItems },
      { id: "training", title: "Training", items: trainingItems },
      { id: "money", title: "Money", items: moneyItems },
      { id: "other", title: "Other", items: otherItems },
    ];
  }, [slug, permissions.canViewAlumni]);

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
    } else if (item.href === "/(app)") {
      router.navigate(item.href);
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

  const renderNavItem = (item: NavItem, isSignOut = false) => {
    const Icon = item.icon;
    const isActive = !isSignOut && isRouteActive(item.href);

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
        <Icon size={18} color={isSignOut ? SEMANTIC.error : NEUTRAL.placeholder} />
        <Text style={[styles.navLabel, isSignOut && styles.signOutLabel]}>{item.label}</Text>
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
        {/* Profile Card */}
        <Pressable
          style={({ pressed }) => [styles.profileCard, pressed && styles.profileCardPressed]}
          onPress={() => {
            props.navigation.closeDrawer();
            router.push("/(app)/(drawer)/profile");
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
            {displayEmail && <Text style={styles.profileEmail}>{displayEmail}</Text>}
          </View>
        </Pressable>
        <View style={styles.divider} />

        {/* Sections */}
        {sections.map((section) => (
          <View key={section.id} style={styles.section}>
            {section.title && <Text style={styles.sectionHeader}>{section.title}</Text>}
            {section.items.map((item) => renderNavItem(item))}
          </View>
        ))}
      </DrawerContentScrollView>

      {/* Pinned Footer */}
      {slug && (
        <View style={[styles.pinnedFooter, { paddingBottom: bottomInset }]}>
          <View style={styles.divider} />
          {pinnedItems.map((item) => renderNavItem(item))}
          {renderNavItem({ label: "Sign Out", href: "", icon: LogOut }, true)}
        </View>
      )}
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
    paddingTop: spacing.xs,
  },
});
