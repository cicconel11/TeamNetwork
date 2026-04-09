import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ChevronLeft, Pin, Pencil, Eye, EyeOff, Trash2, ExternalLink } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { getWebPath } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { formatMonthDayYearSafe } from "@/lib/date-format";
import type { Announcement } from "@teammeet/types";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

export default function AnnouncementDetailScreen() {
  const { announcementId } = useLocalSearchParams<{ announcementId: string }>();
  const { orgSlug, orgId } = useOrg();
  const router = useRouter();
  const { permissions } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    centered: {
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
    },
    statusRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    pinnedBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: s.warningLight,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.sm,
      gap: 4,
    },
    pinnedText: {
      ...TYPOGRAPHY.overline,
      fontSize: 10,
      color: s.warningDark,
    },
    draftBadge: {
      backgroundColor: n.divider,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.sm,
    },
    draftText: {
      ...TYPOGRAPHY.overline,
      fontSize: 10,
      color: n.secondary,
    },
    title: {
      ...TYPOGRAPHY.headlineMedium,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    date: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginBottom: SPACING.lg,
    },
    bodyCard: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: n.border,
      ...SHADOWS.sm,
    },
    bodyText: {
      ...TYPOGRAPHY.bodyLarge,
      color: n.foreground,
      lineHeight: 26,
    },
    metaSection: {
      marginTop: SPACING.lg,
      paddingTop: SPACING.md,
      borderTopWidth: 1,
      borderTopColor: n.border,
    },
    metaLabel: {
      ...TYPOGRAPHY.overline,
      color: n.muted,
      marginBottom: SPACING.xs,
    },
    metaValue: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
      textAlign: "center" as const,
      marginBottom: SPACING.md,
    },
    backButtonAlt: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
    },
    backButtonAltText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },
    loadingOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: n.surface + "cc",
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
  }));

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    async function fetchAnnouncement() {
      if (!announcementId || !orgSlug) return;

      try {
        setLoading(true);
        const { data: orgData } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (!orgData) throw new Error("Organization not found");

        const { data, error: announcementError } = await supabase
          .from("announcements")
          .select("*")
          .eq("id", announcementId)
          .eq("organization_id", orgData.id)
          .is("deleted_at", null)
          .single();

        if (announcementError) throw announcementError;
        setAnnouncement(data as Announcement);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchAnnouncement();
  }, [announcementId, orgSlug]);

  const formatDate = (dateString: string | null) => {
    return formatMonthDayYearSafe(dateString, "");
  };

  const handleTogglePin = async () => {
    if (!announcement) return;
    setIsUpdating(true);
    try {
      const { error: updateError } = await supabase
        .from("announcements")
        .update({
          is_pinned: !announcement.is_pinned,
          updated_at: new Date().toISOString(),
        })
        .eq("id", announcement.id);

      if (updateError) throw updateError;
      setAnnouncement({ ...announcement, is_pinned: !announcement.is_pinned });
    } catch (e) {
      if (Platform.OS === "web") {
        window.alert("Failed to update pin status");
      } else {
        Alert.alert("Error", "Failed to update pin status");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!announcement) return;
    setIsUpdating(true);
    try {
      const newPublishedAt = announcement.published_at ? null : new Date().toISOString();
      const { error: updateError } = await supabase
        .from("announcements")
        .update({
          published_at: newPublishedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", announcement.id);

      if (updateError) throw updateError;
      setAnnouncement({ ...announcement, published_at: newPublishedAt });
    } catch (e) {
      if (Platform.OS === "web") {
        window.alert("Failed to update publish status");
      } else {
        Alert.alert("Error", "Failed to update publish status");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = () => {
    if (!announcement) return;

    const performDelete = async () => {
      setIsUpdating(true);
      try {
        const { error: deleteError } = await supabase
          .from("announcements")
          .update({
            deleted_at: new Date().toISOString(),
          })
          .eq("id", announcement.id);

        if (deleteError) throw deleteError;
        router.back();
      } catch (e) {
        if (Platform.OS === "web") {
          window.alert("Failed to delete announcement");
        } else {
          Alert.alert("Error", "Failed to delete announcement");
        }
        setIsUpdating(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Are you sure you want to delete "${announcement.title}"?`)) {
        performDelete();
      }
    } else {
      Alert.alert(
        "Delete Announcement",
        `Are you sure you want to delete "${announcement.title}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: performDelete,
          },
        ]
      );
    }
  };

  const handleOpenInWeb = () => {
    const webUrl = getWebPath(orgSlug, `announcements/${announcementId}`);
    Linking.openURL(webUrl);
  };

  const handleEdit = () => {
    router.push(`/(app)/${orgSlug}/announcements/${announcementId}/edit`);
  };

  // Admin overflow menu items
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions || !announcement) return [];

    const items: OverflowMenuItem[] = [
      {
        id: "edit",
        label: "Edit",
        icon: <Pencil size={20} color={neutral.foreground} />,
        onPress: handleEdit,
      },
      {
        id: "toggle-pin",
        label: announcement.is_pinned ? "Unpin" : "Pin",
        icon: <Pin size={20} color={neutral.foreground} />,
        onPress: handleTogglePin,
      },
      {
        id: "toggle-publish",
        label: announcement.published_at ? "Unpublish" : "Publish",
        icon: announcement.published_at ? (
          <EyeOff size={20} color={neutral.foreground} />
        ) : (
          <Eye size={20} color={neutral.foreground} />
        ),
        onPress: handleTogglePublish,
      },
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={neutral.foreground} />,
        onPress: handleOpenInWeb,
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={20} color={semantic.error} />,
        onPress: handleDelete,
        destructive: true,
      },
    ];

    return items;
  }, [permissions.canUseAdminActions, announcement, orgSlug, announcementId, neutral, semantic]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={semantic.success} />
      </View>
    );
  }

  if (error || !announcement) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error || "Announcement not found"}</Text>
        <Pressable style={({ pressed }) => [styles.backButtonAlt, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Text style={styles.backButtonAltText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Announcement
              </Text>
            </View>
            {adminMenuItems.length > 0 && (
              <OverflowMenu
                items={adminMenuItems}
                accessibilityLabel="Announcement options"
                iconColor={APP_CHROME.headerTitle}
              />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Status badges */}
        <View style={styles.statusRow}>
          {announcement.is_pinned && (
            <View style={styles.pinnedBadge}>
              <Pin size={12} color={semantic.warningDark} />
              <Text style={styles.pinnedText}>PINNED</Text>
            </View>
          )}
          {!announcement.published_at && permissions.canUseAdminActions && (
            <View style={styles.draftBadge}>
              <Text style={styles.draftText}>DRAFT</Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{announcement.title}</Text>

        {/* Date */}
        <Text style={styles.date}>
          {formatDate(announcement.published_at || announcement.created_at)}
        </Text>

        {/* Body */}
        {announcement.body && (
          <View style={styles.bodyCard}>
            <Text style={styles.bodyText}>{announcement.body}</Text>
          </View>
        )}

        {/* Audience info (admin only) */}
        {permissions.canUseAdminActions && announcement.audience && (
          <View style={styles.metaSection}>
            <Text style={styles.metaLabel}>Audience</Text>
            <Text style={styles.metaValue}>
              {announcement.audience === "all"
                ? "All Members"
                : announcement.audience === "active_members"
                ? "Active Members"
                : announcement.audience === "members"
                ? "Members"
                : announcement.audience === "alumni"
                ? "Alumni"
                : announcement.audience === "individuals"
                ? `${announcement.audience_user_ids?.length || 0} specific people`
                : announcement.audience}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Loading overlay */}
      {isUpdating && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={semantic.success} />
        </View>
      )}
    </View>
  );
}
