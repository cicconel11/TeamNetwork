import React, { useMemo } from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import { DrawerContentScrollView, type DrawerContentComponentProps } from "@react-navigation/drawer";
import { useGlobalSearchParams, useRouter } from "expo-router";
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
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Settings;
  openInWeb?: boolean;
}

export function DrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const { orgSlug } = useGlobalSearchParams<{ orgSlug?: string }>();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const slug = typeof orgSlug === "string" ? orgSlug : "";
  const userMeta = (user?.user_metadata ?? {}) as { name?: string; avatar_url?: string };
  const displayName = userMeta.name || user?.email || "Member";
  const displayEmail = user?.email || "";
  const avatarUrl = userMeta.avatar_url || "";
  const initial = displayName.trim().charAt(0).toUpperCase() || "M";

  const navItems = useMemo<NavItem[]>(() => {
    if (!slug) {
      return [
        {
          label: "Organizations",
          href: "/(app)",
          icon: Building2,
        },
      ];
    }

    const items: NavItem[] = [
      {
        label: "Home",
        href: `/${slug}`,
        icon: Home,
      },
      {
        label: "Chat",
        href: `/${slug}/chat`,
        icon: MessageCircle,
      },
    ];

    // Alumni: in-app navigation, gated by permission
    if (permissions.canViewAlumni) {
      items.push({
        label: "Alumni",
        href: `/${slug}/alumni`,
        icon: GraduationCap,
      });
    }

    items.push(
      {
        label: "Mentorship",
        href: `/${slug}/mentorship`,
        icon: Handshake,
      },
      {
        label: "Workouts",
        href: `/${slug}/workouts`,
        icon: Dumbbell,
      },
      {
        label: "Competition",
        href: `/${slug}/competition`,
        icon: Award,
      },
      {
        label: "Philanthropy",
        href: `/${slug}/philanthropy`,
        icon: Heart,
      },
      {
        label: "Donations",
        href: `/${slug}/donations`,
        icon: DollarSign,
      },
      {
        label: "Expenses",
        href: `/${slug}/expenses`,
        icon: Receipt,
      },
      {
        label: "Records",
        href: `/${slug}/records`,
        icon: Trophy,
      },
      {
        label: "Schedules",
        href: `/${slug}/schedules`,
        icon: BookOpen,
      },
      {
        label: "Forms",
        href: `/${slug}/forms`,
        icon: ClipboardList,
      },
      {
        label: "Settings",
        href: `/${slug}/settings`,
        icon: Settings,
      },
      {
        label: "Navigation",
        href: `/${slug}/settings/navigation`,
        icon: SlidersHorizontal,
      },
      {
        label: "Organizations",
        href: "/(app)",
        icon: Building2,
      },
    );

    return items;
  }, [slug, permissions.canViewAlumni]);

  const handleNavigate = (item: NavItem) => {
    props.navigation.closeDrawer();
    if (item.openInWeb) {
      const baseUrl = getWebAppUrl().replace(/\/$/, "");
      void Linking.openURL(`${baseUrl}${item.href}`);
      return;
    }
    // Use push for Home and Organizations to preserve back navigation
    // Use replace for secondary screens to avoid stacking
    if (item.href === `/${slug}` || item.href === "/(app)") {
      router.push(item.href);
    } else {
      router.replace(item.href);
    }
  };

  const handleSignOut = async () => {
    props.navigation.closeDrawer();
    await signOut();
  };

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={styles.container}
      scrollEnabled
    >
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarFallback}>{initial}</Text>
          )}
        </View>
        <View style={styles.profileMeta}>
          <Text style={styles.profileName}>{displayName}</Text>
          {displayEmail ? <Text style={styles.profileEmail}>{displayEmail}</Text> : null}
        </View>
      </View>

      <View style={styles.section}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => handleNavigate(item)}
              style={({ pressed }) => [
                styles.navItem,
                pressed ? styles.navItemPressed : null,
              ]}
            >
              <Icon size={20} color={colors.foreground} />
              <Text style={styles.navLabel}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.navItem,
            pressed ? styles.navItemPressed : null,
          ]}
        >
          <LogOut size={20} color={colors.error} />
          <Text style={[styles.navLabel, styles.signOutLabel]}>Sign Out</Text>
        </Pressable>
      </View>
    </DrawerContentScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      padding: spacing.lg,
      gap: spacing.lg,
    },
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 14,
      borderCurve: "continuous",
      backgroundColor: colors.mutedSurface,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    avatarImage: {
      width: 48,
      height: 48,
    },
    avatarFallback: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    profileMeta: {
      flex: 1,
    },
    profileName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    profileEmail: {
      marginTop: 2,
      fontSize: fontSize.sm,
      color: colors.muted,
    },
    section: {
      gap: spacing.sm,
    },
    navItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      backgroundColor: colors.card,
    },
    navItemPressed: {
      backgroundColor: colors.mutedSurface,
    },
    navLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    signOutLabel: {
      color: colors.error,
    },
  });
