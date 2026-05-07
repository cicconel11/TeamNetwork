import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useSchedules } from "@/hooks/useSchedules";
import { useScheduleFiles } from "@/hooks/useScheduleFiles";
import {
  useScheduleSourceSummaries,
  type ScheduleSourceSummary,
} from "@/hooks/useScheduleSourceSummaries";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { AvailabilityGrid } from "@/components/schedules/AvailabilityGrid";
import { ErrorState } from "@/components/ui";
import { APP_CHROME } from "@/lib/chrome";
import { getWebPath } from "@/lib/web-api";
import { getScheduleMySettingsPath } from "@/lib/schedules/mobile-schedule-settings";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import type { ScheduleFile } from "@teammeet/types";

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeSync(value: string | null) {
  if (!value) return "Never synced";
  return new Date(value).toLocaleString();
}

function getVendorLabel(vendorId: ScheduleSourceSummary["vendor_id"]) {
  switch (vendorId) {
    case "google_calendar":
      return "Google Calendar";
    case "generic_html":
      return "Approved Web Source";
    case "ics":
      return "ICS Feed";
    case "vendorA":
    case "vendorB":
      return "Approved Vendor";
    default:
      return "Schedule Source";
  }
}

export default function ScheduleSourcesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const { isOffline } = useNetwork();

  const {
    allSchedules,
    totalMembers,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
    refetchIfStale: refetchSchedulesIfStale,
  } = useSchedules(orgId, isAdmin);

  const {
    allFiles,
    loading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
    refetchIfStale: refetchFilesIfStale,
    getSignedUrl,
  } = useScheduleFiles(orgSlug || "", user?.id, isAdmin);

  const {
    sources,
    loading: sourcesLoading,
    syncingSourceId,
    togglingSourceId,
    removingSourceId,
    error: sourcesError,
    notice,
    refetch: refetchSources,
    syncSource,
    toggleSourceStatus,
    removeSource,
  } = useScheduleSourceSummaries(orgId, isAdmin);

  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.background,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
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
    backButton: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.sm,
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    backButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      gap: SPACING.lg,
    },
    section: {
      gap: SPACING.sm,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    sectionTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
    },
    sectionHint: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      ...SHADOWS.sm,
    },
    sourceCard: {
      gap: SPACING.sm,
    },
    sourceHeader: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.sm,
    },
    sourceTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    sourceMeta: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      marginTop: 2,
    },
    sourceStatus: {
      alignSelf: "flex-start" as const,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      backgroundColor: n.background,
    },
    sourceStatusActive: {
      backgroundColor: s.successLight,
    },
    sourceStatusPaused: {
      backgroundColor: s.warningLight,
    },
    sourceStatusError: {
      backgroundColor: s.errorLight,
    },
    sourceStatusText: {
      ...TYPOGRAPHY.caption,
      color: n.secondary,
      textTransform: "capitalize" as const,
    },
    sourceStatusTextActive: {
      color: s.successDark,
    },
    sourceStatusTextPaused: {
      color: s.warning,
    },
    sourceStatusTextError: {
      color: s.error,
    },
    sourceError: {
      ...TYPOGRAPHY.bodySmall,
      color: s.error,
    },
    actionRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    actionButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.background,
    },
    destructiveButton: {
      borderColor: s.error,
      backgroundColor: s.errorLight,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    destructiveButtonText: {
      color: s.error,
    },
    filesList: {
      gap: SPACING.sm,
    },
    fileItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.sm,
    },
    fileInfo: {
      flex: 1,
      gap: 2,
    },
    fileName: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    fileMeta: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
    },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: n.background,
    },
    emptyState: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.xl,
      gap: SPACING.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
    },
    emptyText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      textAlign: "center" as const,
    },
  }));

  const [refreshing, setRefreshing] = useState(false);
  const [viewingFileId, setViewingFileId] = useState<string | null>(null);
  const refreshRef = useRef(false);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // no-op
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      refetchSchedulesIfStale();
      refetchFilesIfStale();
      refetchSources();
    }, [refetchFilesIfStale, refetchSchedulesIfStale, refetchSources])
  );

  useAutoRefetchOnReconnect(
    useCallback(() => {
      refetchSchedules();
      refetchFiles();
      refetchSources();
    }, [refetchFiles, refetchSchedules, refetchSources])
  );

  const handleRefresh = useCallback(async () => {
    if (refreshRef.current) return;
    refreshRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(refetchSchedules()),
        refetchFiles(),
        refetchSources(),
      ]);
    } finally {
      refreshRef.current = false;
      setRefreshing(false);
    }
  }, [refetchFiles, refetchSchedules, refetchSources]);

  const handleViewFile = useCallback(
    async (file: ScheduleFile) => {
      setViewingFileId(file.id);
      try {
        const url = await getSignedUrl(file.file_path);
        if (!url) {
          Alert.alert("Unable to open file", "The secure file link could not be created.");
          return;
        }
        await WebBrowser.openBrowserAsync(url);
      } catch {
        Alert.alert("Unable to open file", "Please try again.");
      } finally {
        setViewingFileId(null);
      }
    },
    [getSignedUrl]
  );

  const openWebSources = useCallback(() => {
    if (!orgSlug) return;
    Linking.openURL(getWebPath(orgSlug, "calendar/sources"));
  }, [orgSlug]);

  const handleRemoveSource = useCallback(
    (sourceId: string) => {
      Alert.alert("Remove Source", "Remove this schedule source from the team calendar?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            removeSource(sourceId);
          },
        },
      ]);
    },
    [removeSource]
  );

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "S"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Manage Sources</Text>
              </View>
              <Pressable
                onPress={() => orgSlug && router.replace(getScheduleMySettingsPath(orgSlug))}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Back</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.scrollContent}>
            <View style={styles.card}>
              <View style={styles.emptyState}>
                <ShieldCheck size={28} color={APP_CHROME.gradientStart} />
                <Text style={styles.emptyTitle}>Admins only</Text>
                <Text style={styles.emptyText}>
                  Team source management is only available to organization admins.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const error = sourcesError || schedulesError || filesError;
  const isInitialLoad = sourcesLoading || schedulesLoading || filesLoading;

  if (error && !isInitialLoad && sources.length === 0) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "S"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Manage Sources</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <ErrorState onRetry={handleRefresh} title="Unable to load schedule sources" isOffline={isOffline} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "S"}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Manage Sources</Text>
              <Text style={styles.headerMeta}>
                {sources.length} {sources.length === 1 ? "source" : "sources"} • {allSchedules.length} team schedules
              </Text>
            </View>
            <Pressable
              onPress={() => orgSlug && router.replace(getScheduleMySettingsPath(orgSlug))}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Mine</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {notice ? (
            <View style={styles.card}>
              <Text style={styles.sectionHint}>{notice}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Connected Sources</Text>
                <Text style={styles.sectionHint}>Review sync state, pause or resume imports, and remove stale sources.</Text>
              </View>
              <Pressable style={styles.actionButton} onPress={openWebSources}>
                <ExternalLink size={16} color={APP_CHROME.gradientStart} />
                <Text style={styles.actionButtonText}>Advanced Setup</Text>
              </Pressable>
            </View>
            {sources.length === 0 ? (
              <View style={styles.card}>
                <View style={styles.emptyState}>
                  <ShieldCheck size={28} color={APP_CHROME.gradientStart} />
                  <Text style={styles.emptyTitle}>No sources connected</Text>
                  <Text style={styles.emptyText}>
                    Add or approve new team schedule sources from the web source manager.
                  </Text>
                </View>
              </View>
            ) : (
              sources.map((source) => (
                <View key={source.id} style={[styles.card, styles.sourceCard]}>
                  <View style={styles.sourceHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sourceTitle}>{source.title || getVendorLabel(source.vendor_id)}</Text>
                      <Text style={styles.sourceMeta}>{getVendorLabel(source.vendor_id)} • {source.maskedUrl}</Text>
                      <Text style={styles.sourceMeta}>
                        Last sync: {formatRelativeSync(source.last_synced_at)}
                        {typeof source.last_event_count === "number" ? ` • ${source.last_event_count} events` : ""}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.sourceStatus,
                        source.status === "active" && styles.sourceStatusActive,
                        source.status === "paused" && styles.sourceStatusPaused,
                        source.status === "error" && styles.sourceStatusError,
                      ]}
                    >
                      <Text
                        style={[
                          styles.sourceStatusText,
                          source.status === "active" && styles.sourceStatusTextActive,
                          source.status === "paused" && styles.sourceStatusTextPaused,
                          source.status === "error" && styles.sourceStatusTextError,
                        ]}
                      >
                        {source.status}
                      </Text>
                    </View>
                  </View>
                  {source.last_error ? (
                    <Text style={styles.sourceError}>{source.last_error}</Text>
                  ) : null}
                  <View style={styles.actionRow}>
                    <Pressable
                      style={styles.actionButton}
                      onPress={() => syncSource(source.id)}
                      disabled={syncingSourceId === source.id}
                    >
                      {syncingSourceId === source.id ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <RefreshCw size={16} color={APP_CHROME.gradientStart} />
                      )}
                      <Text style={styles.actionButtonText}>Sync now</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionButton}
                      onPress={() => toggleSourceStatus(source)}
                      disabled={togglingSourceId === source.id}
                    >
                      {togglingSourceId === source.id ? (
                        <ActivityIndicator size="small" />
                      ) : source.status === "paused" ? (
                        <PlayCircle size={16} color={APP_CHROME.gradientStart} />
                      ) : (
                        <PauseCircle size={16} color={APP_CHROME.gradientStart} />
                      )}
                      <Text style={styles.actionButtonText}>
                        {source.status === "paused" ? "Resume" : "Pause"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionButton, styles.destructiveButton]}
                      onPress={() => handleRemoveSource(source.id)}
                      disabled={removingSourceId === source.id}
                    >
                      {removingSourceId === source.id ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <Trash2 size={16} color="#dc2626" />
                      )}
                      <Text style={[styles.actionButtonText, styles.destructiveButtonText]}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Team Availability</Text>
                <Text style={styles.sectionHint}>See how much of the team has schedule coverage today.</Text>
              </View>
            </View>
            <View style={styles.card}>
              <AvailabilityGrid schedules={allSchedules} totalMembers={totalMembers} />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Uploaded Team Files</Text>
                <Text style={styles.sectionHint}>Review member-uploaded PDFs and screenshots from one place.</Text>
              </View>
            </View>
            <View style={styles.card}>
              {allFiles.length === 0 ? (
                <View style={styles.emptyState}>
                  <FileText size={28} color={APP_CHROME.headerMeta} />
                  <Text style={styles.emptyTitle}>No team files yet</Text>
                  <Text style={styles.emptyText}>
                    Members have not uploaded any class schedules yet.
                  </Text>
                </View>
              ) : (
                <View style={styles.filesList}>
                  {allFiles.map((file) => (
                    <View key={file.id} style={styles.fileItem}>
                      {file.mime_type?.startsWith("image/") ? (
                        <ImageIcon size={18} color={APP_CHROME.headerMeta} />
                      ) : (
                        <FileText size={18} color={APP_CHROME.headerMeta} />
                      )}
                      <View style={styles.fileInfo}>
                        <Text style={styles.fileName} numberOfLines={1}>
                          {file.file_name}
                        </Text>
                        <Text style={styles.fileMeta}>
                          {formatFileSize(file.file_size)}
                          {"users" in file && file.users
                            ? ` • ${String((file.users as { name?: string | null; email?: string | null }).name || (file.users as { email?: string | null }).email || "Unknown")}`
                            : ""}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => handleViewFile(file)}
                        disabled={viewingFileId === file.id}
                      >
                        {viewingFileId === file.id ? (
                          <ActivityIndicator size="small" />
                        ) : (
                          <Eye size={16} color={APP_CHROME.gradientStart} />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
