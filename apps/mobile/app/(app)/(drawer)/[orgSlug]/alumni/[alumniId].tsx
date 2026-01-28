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
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  MapPin,
  Briefcase,
  Building2,
  GraduationCap,
  Mail,
  Linkedin,
  RefreshCw,
} from "lucide-react-native";
import { useAlumniDetail } from "@/hooks/useAlumniDetail";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";

export default function AlumniDetailScreen() {
  const { alumniId, orgSlug } = useLocalSearchParams<{ alumniId: string; orgSlug: string }>();
  const { alumni, loading, error, refetch } = useAlumniDetail(orgSlug || "", alumniId || "");
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);

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
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Alumni" }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !alumni) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Alumni" }} />
        <View style={styles.errorContainer}>
          <RefreshCw size={40} color={colors.border} />
          <Text style={styles.errorTitle}>Unable to load profile</Text>
          <Text style={styles.errorText}>{error || "Alumni not found"}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={handleRefresh}
          >
            <RefreshCw size={16} color={colors.primaryForeground} />
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const roleTitle = alumni.position_title || alumni.job_title;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: getDisplayName() }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
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
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                onPress={handleEmailPress}
              >
                <Mail size={18} color={colors.primary} />
                <Text style={styles.actionButtonText}>Email</Text>
              </Pressable>
            )}
            {alumni.linkedin_url && (
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                onPress={handleLinkedInPress}
              >
                <Linkedin size={18} color={colors.primary} />
                <Text style={styles.actionButtonText}>LinkedIn</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Details */}
        <View style={styles.section}>
          {alumni.graduation_year && (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <GraduationCap size={18} color={colors.muted} />
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
                <Briefcase size={18} color={colors.muted} />
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
                <Building2 size={18} color={colors.muted} />
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
                <MapPin size={18} color={colors.muted} />
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    errorContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl,
      gap: spacing.sm,
    },
    errorTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginTop: spacing.sm,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.muted,
      textAlign: "center",
    },
    retryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
      borderRadius: borderRadius.md,
    },
    retryButtonPressed: {
      opacity: 0.8,
    },
    retryButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },

    // Header
    header: {
      alignItems: "center",
      paddingVertical: spacing.lg,
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      marginBottom: spacing.md,
    },
    avatarPlaceholder: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primaryLight,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: spacing.md,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: fontWeight.semibold,
      color: colors.primaryDark,
    },
    name: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      textAlign: "center",
    },
    title: {
      fontSize: fontSize.base,
      color: colors.muted,
      marginTop: 4,
      textAlign: "center",
    },
    company: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      marginTop: 2,
      textAlign: "center",
    },

    // Actions
    actionsRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    actionButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      backgroundColor: colors.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionButtonPressed: {
      opacity: 0.7,
    },
    actionButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },

    // Details section
    section: {
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      overflow: "hidden",
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    detailIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.mutedSurface,
      justifyContent: "center",
      alignItems: "center",
      marginRight: spacing.md,
    },
    detailContent: {
      flex: 1,
    },
    detailLabel: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    detailValue: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      marginTop: 2,
    },
  });
