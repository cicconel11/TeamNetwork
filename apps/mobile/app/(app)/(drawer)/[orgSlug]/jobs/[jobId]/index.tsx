import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  MoreHorizontal,
  Share2,
} from "lucide-react-native";
import { shareJob } from "@/lib/share";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/hooks/useAuth";
import { useJobs } from "@/hooks/useJobs";
import { useOrgRole } from "@/hooks/useOrgRole";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { openEmailAddress, openHttpsUrl } from "@/lib/url-safety";
import type { JobPostingWithPoster } from "@/types/jobs";


const EXPERIENCE_LEVEL_LABELS: Record<string, string> = {
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior",
  executive: "Executive",
};

function formatRelativeDate(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export default function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { orgId, orgSlug } = useOrg();
  const router = useRouter();
  const { user } = useAuth();
  const { permissions } = useOrgRole();
  const { jobs, deleteJob } = useJobs(orgId);

  const [isDeleting, setIsDeleting] = useState(false);

  const { neutral, semantic } = useAppColorScheme();
  const locationTypeConfig: Record<string, { label: string; bg: string; color: string }> = {
    remote: { label: "Remote", bg: semantic.infoLight, color: semantic.infoDark },
    onsite: { label: "On-site", bg: semantic.warningLight, color: semantic.warningDark },
    hybrid: { label: "Hybrid", bg: semantic.successLight, color: semantic.successDark },
  };
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
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
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
    },
    headerSpacer: {
      width: 36,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.md,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
    titleSection: {
      gap: SPACING.xs,
    },
    jobTitle: {
      ...TYPOGRAPHY.headlineLarge,
      color: n.foreground,
    },
    companyRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    companyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    locationRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    locationText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
    },
    badgeRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.xs,
    },
    badge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xxs,
      borderRadius: RADIUS.full,
    },
    badgeText: {
      ...TYPOGRAPHY.labelSmall,
    },
    badgeNeutral: {
      backgroundColor: n.background,
    },
    badgeTextNeutral: {
      ...TYPOGRAPHY.labelSmall,
      color: n.secondary,
    },
    section: {
      backgroundColor: n.background,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      gap: SPACING.sm,
      ...SHADOWS.sm,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    descriptionText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      lineHeight: 24,
    },
    contactRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    contactLink: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.info,
      flex: 1,
    },
    footerSection: {
      gap: SPACING.xxs,
      paddingTop: SPACING.sm,
    },
    footerText: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    applyContainer: {
      borderTopWidth: 1,
      borderTopColor: n.border,
      backgroundColor: n.surface,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
    },
    applyInner: {},
    applyButton: {
      backgroundColor: s.success,
      borderRadius: RADIUS.lg,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    applyButtonPressed: {
      opacity: 0.9,
    },
    applyButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    loadingOverlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: n.overlay,
      justifyContent: "center" as const,
      alignItems: "center" as const,
    },
  }));

  const job: JobPostingWithPoster | undefined = useMemo(
    () => jobs.find((j) => j.id === jobId),
    [jobs, jobId]
  );

  const isOwner = user != null && job != null && job.posted_by === user.id;
  const canManage = isOwner || permissions.canUseAdminActions;

  const handleApply = useCallback(() => {
    if (!job) return;
    if (job.application_url) {
      void openHttpsUrl(job.application_url);
    } else if (job.contact_email) {
      void openEmailAddress(job.contact_email);
    }
  }, [job]);

  const handleEdit = useCallback(() => {
    router.push(`/(app)/(drawer)/${orgSlug}/jobs/${jobId}/edit`);
  }, [router, orgSlug, jobId]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Job Posting",
      "Are you sure you want to delete this job posting? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!jobId) return;
            setIsDeleting(true);
            try {
              await deleteJob(jobId);
              router.back();
            } catch (e) {
              Alert.alert("Error", (e as Error).message || "Failed to delete job posting.");
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }, [jobId, deleteJob, router]);

  const handleShare = useCallback(() => {
    if (!job) return;
    void shareJob({ id: job.id, title: job.title, orgSlug });
  }, [job, orgSlug]);

  const overflowItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [
      {
        id: "share",
        label: "Share Job",
        icon: <Share2 size={20} color={neutral.foreground} />,
        onPress: handleShare,
      },
    ];
    if (!canManage) return items;
    return [
      ...items,
      {
        id: "edit",
        label: "Edit Job",
        icon: <Briefcase size={20} color={neutral.foreground} />,
        onPress: handleEdit,
      },
      {
        id: "delete",
        label: "Delete Job",
        icon: <MoreHorizontal size={20} color={semantic.error} />,
        onPress: handleDelete,
        destructive: true,
      },
    ];
  }, [canManage, handleEdit, handleDelete, handleShare, neutral.foreground, semantic.error]);

  const canApply =
    job != null && (job.application_url != null || job.contact_email != null);

  if (job == null) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.navHeader}>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
              >
                <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>Job Details</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.centered}>
          <ActivityIndicator color={semantic.success} />
        </View>
      </View>
    );
  }

  const locationConfig = job.location_type ? locationTypeConfig[job.location_type] : null;
  const experienceLabel = job.experience_level
    ? EXPERIENCE_LEVEL_LABELS[job.experience_level]
    : null;
  const posterName = job.poster?.name ?? "Unknown";
  const relativeDate = formatRelativeDate(job.created_at);

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
            >
              <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Job Details
            </Text>
            {overflowItems.length > 0 && (
              <OverflowMenu
                items={overflowItems}
                accessibilityLabel="Job options"
                iconColor={APP_CHROME.headerTitle}
              />
            )}
            {overflowItems.length === 0 && <View style={styles.headerSpacer} />}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Company */}
        <View style={styles.titleSection}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <View style={styles.companyRow}>
            <Building2 size={16} color={neutral.muted} />
            <Text style={styles.companyText}>{job.company}</Text>
          </View>
          {job.location != null && (
            <View style={styles.locationRow}>
              <MapPin size={16} color={neutral.muted} />
              <Text style={styles.locationText}>{job.location}</Text>
            </View>
          )}
        </View>

        {/* Badges */}
        {(locationConfig != null || experienceLabel != null) && (
          <View style={styles.badgeRow}>
            {locationConfig != null && (
              <View style={[styles.badge, { backgroundColor: locationConfig.bg }]}>
                <Text style={[styles.badgeText, { color: locationConfig.color }]}>
                  {locationConfig.label}
                </Text>
              </View>
            )}
            {experienceLabel != null && (
              <View style={[styles.badge, styles.badgeNeutral]}>
                <Text style={styles.badgeTextNeutral}>{experienceLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* Description */}
        {job.description != null && job.description.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About the Role</Text>
            <Text style={styles.descriptionText} selectable>
              {job.description}
            </Text>
          </View>
        )}

        {/* Contact Info */}
        {(job.application_url != null || job.contact_email != null) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How to Apply</Text>
            {job.application_url != null && (
              <Pressable
                onPress={() => {
                  void openHttpsUrl(job.application_url!);
                }}
                style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
              >
                <ExternalLink size={16} color={semantic.info} />
                <Text style={styles.contactLink} numberOfLines={1}>
                  {job.application_url}
                </Text>
              </Pressable>
            )}
            {job.contact_email != null && (
              <Pressable
                onPress={() => {
                  void openEmailAddress(job.contact_email!);
                }}
                style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
              >
                <Mail size={16} color={semantic.info} />
                <Text style={styles.contactLink}>{job.contact_email}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Posted By */}
        <View style={styles.footerSection}>
          <Text style={styles.footerText}>
            Posted by {posterName} · {relativeDate}
          </Text>
          {job.expires_at != null && (
            <Text style={styles.footerText}>
              Expires {new Date(job.expires_at).toLocaleDateString()}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Apply Button */}
      {canApply && (
        <View style={styles.applyContainer}>
          <SafeAreaView edges={["bottom"]} style={styles.applyInner}>
            <Pressable
              onPress={handleApply}
              style={({ pressed }) => [styles.applyButton, pressed && styles.applyButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Apply for this job"
            >
              <Text style={styles.applyButtonText}>Apply Now</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      )}

      {isDeleting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={semantic.success} />
        </View>
      )}
    </View>
  );
}
