import { useMemo, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  MapPin,
  Briefcase,
  Building2,
  GraduationCap,
  Mail,
  Linkedin,
  RefreshCw,
  Pencil,
} from "lucide-react-native";
import { useAlumniDetail } from "@/hooks/useAlumniDetail";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

const DETAIL_COLORS = {
  background: "#ffffff",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#f8fafc",
  mutedSurface: "#f1f5f9",
  success: "#059669",
  successLight: "#d1fae5",
  successDark: "#047857",
  error: "#ef4444",
};

export default function AlumniDetailScreen() {
  const { alumniId, orgSlug } = useLocalSearchParams<{ alumniId: string; orgSlug: string }>();
  const { alumni, loading, error, refetch } = useAlumniDetail(orgSlug || "", alumniId || "");
  const { isAdmin } = useOrgRole();
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);
  const [refreshing, setRefreshing] = useState(false);

  const handleEditPress = useCallback(() => {
    if (alumniId && orgSlug) {
      router.push(`/(app)/${orgSlug}/alumni/${alumniId}/edit`);
    }
  }, [alumniId, orgSlug, router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleEmailPress = useCallback(() => {
    if (alumni?.email) {
      Linking.openURL(`mailto:${alumni.email}`);
    }
  }, [alumni?.email]);

  const handleLinkedInPress = useCallback(() => {
    if (alumni?.linkedin_url) {
      Linking.openURL(alumni.linkedin_url);
    }
  }, [alumni?.linkedin_url]);

  const getInitials = () => {
    if (alumni?.first_name && alumni?.last_name) {
      return (alumni.first_name[0] + alumni.last_name[0]).toUpperCase();
    }
    return alumni?.first_name?.[0]?.toUpperCase() || "?";
  };

  const getDisplayName = () => {
    if (alumni?.first_name && alumni?.last_name) return `${alumni.first_name} ${alumni.last_name}`;
    return alumni?.first_name || alumni?.email || "Unknown";
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={DETAIL_COLORS.success} />
      </View>
    );
  }

  if (error || !alumni) {
    return (
      <View style={styles.container}>
        {/* Gradient Header */}
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
                  Alumni
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.errorContainer}>
          <RefreshCw size={40} color={DETAIL_COLORS.border} />
          <Text style={styles.errorTitle}>Unable to load profile</Text>
          <Text style={styles.errorText}>{error || "Alumni not found"}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
            onPress={handleRefresh}
          >
            <RefreshCw size={16} color="#ffffff" />
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const roleTitle = alumni.position_title || alumni.job_title;

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
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
                Alumni Profile
              </Text>
            </View>
            {isAdmin && (
              <Pressable
                onPress={handleEditPress}
                style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.7 }]}
              >
                <Pencil size={18} color={APP_CHROME.headerTitle} />
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={DETAIL_COLORS.success} />
        }
      >
        {/* Header Card */}
        <View style={styles.profileHeader}>
          {alumni.photo_url ? (
            <Image source={alumni.photo_url} style={styles.avatar} contentFit="cover" transition={200} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{getInitials()}</Text>
            </View>
          )}
          <Text style={styles.name}>{getDisplayName()}</Text>
          {roleTitle && (
            <Text style={styles.title}>{roleTitle}</Text>
          )}
          {alumni.current_company && (
            <Text style={styles.company}>{alumni.current_company}</Text>
          )}
        </View>

        {/* Quick Actions */}
        {(alumni.email || alumni.linkedin_url) && (
          <View style={styles.actionsRow}>
            {alumni.email && (
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
                onPress={handleEmailPress}
              >
                <Mail size={18} color={DETAIL_COLORS.success} />
                <Text style={styles.actionButtonText}>Email</Text>
              </Pressable>
            )}
            {alumni.linkedin_url && (
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
                onPress={handleLinkedInPress}
              >
                <Linkedin size={18} color={DETAIL_COLORS.success} />
                <Text style={styles.actionButtonText}>LinkedIn</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Details Section */}
        <View style={styles.section}>
          {alumni.graduation_year && (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <GraduationCap size={18} color={DETAIL_COLORS.mutedText} />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Class Year</Text>
                <Text style={styles.detailValue}>{alumni.graduation_year}</Text>
              </View>
            </View>
          )}

          {alumni.industry && (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Briefcase size={18} color={DETAIL_COLORS.mutedText} />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Industry</Text>
                <Text style={styles.detailValue}>{alumni.industry}</Text>
              </View>
            </View>
          )}

          {alumni.current_company && (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Building2 size={18} color={DETAIL_COLORS.mutedText} />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Company</Text>
                <Text style={styles.detailValue}>{alumni.current_company}</Text>
              </View>
            </View>
          )}

          {alumni.current_city && (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <MapPin size={18} color={DETAIL_COLORS.mutedText} />
              </View>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>Location</Text>
                <Text style={styles.detailValue}>{alumni.current_city}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: DETAIL_COLORS.background,
    },
    centered: {
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
    },
    headerGradient: {
      paddingBottom: SPACING.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      minHeight: 40,
      gap: SPACING.sm,
    },
    backButton: {
      padding: SPACING.xs,
      marginLeft: -SPACING.xs,
    },
    editButton: {
      padding: SPACING.xs,
      marginRight: -SPACING.xs,
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
      paddingBottom: SPACING.xxl,
    },
    errorContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.xl,
      gap: SPACING.sm,
    },
    errorTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: DETAIL_COLORS.primaryText,
      marginTop: SPACING.sm,
    },
    errorText: {
      ...TYPOGRAPHY.bodySmall,
      color: DETAIL_COLORS.mutedText,
      textAlign: "center",
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      marginTop: SPACING.md,
      backgroundColor: DETAIL_COLORS.success,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    retryButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: "#ffffff",
    },

    // Header Card
    profileHeader: {
      alignItems: "center",
      paddingVertical: SPACING.lg,
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      marginBottom: SPACING.md,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      marginBottom: SPACING.md,
    },
    avatarPlaceholder: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: DETAIL_COLORS.successLight,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: SPACING.md,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: "600",
      color: DETAIL_COLORS.successDark,
    },
    name: {
      ...TYPOGRAPHY.headlineMedium,
      color: DETAIL_COLORS.primaryText,
      textAlign: "center",
    },
    title: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.mutedText,
      marginTop: 4,
      textAlign: "center",
    },
    company: {
      ...TYPOGRAPHY.bodySmall,
      color: DETAIL_COLORS.secondaryText,
      marginTop: 2,
      textAlign: "center",
    },

    // Actions
    actionsRow: {
      flexDirection: "row",
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    actionButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
      paddingVertical: SPACING.md,
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: DETAIL_COLORS.border,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: DETAIL_COLORS.success,
    },

    // Details section
    section: {
      backgroundColor: DETAIL_COLORS.card,
      borderRadius: RADIUS.lg,
      overflow: "hidden",
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: DETAIL_COLORS.border,
    },
    detailIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: DETAIL_COLORS.mutedSurface,
      justifyContent: "center",
      alignItems: "center",
      marginRight: SPACING.md,
    },
    detailContent: {
      flex: 1,
    },
    detailLabel: {
      ...TYPOGRAPHY.overline,
      color: DETAIL_COLORS.secondaryText,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    detailValue: {
      ...TYPOGRAPHY.bodyMedium,
      color: DETAIL_COLORS.primaryText,
      marginTop: 2,
    },
  });
