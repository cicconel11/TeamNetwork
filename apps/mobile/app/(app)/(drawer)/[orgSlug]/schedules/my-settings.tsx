import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
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
  BookOpen,
  CalendarSync,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  Plus,
  Trash2,
} from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useSchedules, formatOccurrence, formatTime } from "@/hooks/useSchedules";
import { useScheduleFiles } from "@/hooks/useScheduleFiles";
import { useCalendarSyncPreferences } from "@/hooks/useCalendarSyncPreferences";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAutoRefetchOnReconnect } from "@/hooks/useAutoRefetchOnReconnect";
import { ErrorState } from "@/components/ui";
import { ScheduleFileUpload } from "@/components/schedules/ScheduleFileUpload";
import { showToast } from "@/components/ui/Toast";
import { APP_CHROME } from "@/lib/chrome";
import { getWebPath } from "@/lib/web-api";
import {
  DEFAULT_CALENDAR_SYNC_PREFERENCES,
  getScheduleSourcesPath,
} from "@/lib/schedules/mobile-schedule-settings";
import { SPACING, RADIUS, SHADOWS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import type { ScheduleFile } from "@teammeet/types";

const SYNC_LABELS: Array<{
  key: keyof typeof DEFAULT_CALENDAR_SYNC_PREFERENCES;
  label: string;
  hint: string;
}> = [
  { key: "sync_general", label: "General events", hint: "Practices, team items, and uncategorized events." },
  { key: "sync_game", label: "Games", hint: "Competitions and game-day entries." },
  { key: "sync_meeting", label: "Meetings", hint: "Team meetings and planning sessions." },
  { key: "sync_social", label: "Social", hint: "Social events and team culture activities." },
  { key: "sync_fundraiser", label: "Fundraisers", hint: "Fundraising events added to the calendar." },
  { key: "sync_philanthropy", label: "Philanthropy", hint: "Service and philanthropy events." },
];

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSyncStatus(value: boolean) {
  return value ? "Included in sync" : "Skipped during sync";
}

export default function ScheduleMySettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const { isAdmin } = useOrgRole();
  const { isOffline } = useNetwork();

  const {
    mySchedules,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
    refetchIfStale: refetchSchedulesIfStale,
  } = useSchedules(orgId, false);

  const {
    myFiles,
    loading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
    refetchIfStale: refetchFilesIfStale,
    uploadFile,
    deleteFile,
    getSignedUrl,
  } = useScheduleFiles(orgSlug || "", user?.id, false);

  const {
    preferences,
    loading: prefsLoading,
    saving: prefsSaving,
    error: prefsError,
    refetch: refetchPrefs,
    updatePreferences,
  } = useCalendarSyncPreferences(orgId);

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
    manageSourcesButton: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.sm,
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    manageSourcesText: {
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
    noticeCard: {
      backgroundColor: s.infoLight,
      borderColor: s.info,
    },
    noticeText: {
      ...TYPOGRAPHY.bodySmall,
      color: s.info,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.sm,
    },
    switchInfo: {
      flex: 1,
      paddingRight: SPACING.md,
    },
    switchLabel: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    switchHint: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginTop: 2,
    },
    divider: {
      borderTopWidth: 1,
      borderTopColor: n.border,
      marginTop: SPACING.sm,
      paddingTop: SPACING.sm,
    },
    actionButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.xs,
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    actionButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    secondaryButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.xs,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      backgroundColor: n.background,
      alignSelf: "flex-start" as const,
    },
    secondaryButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
    },
    scheduleCard: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "flex-start" as const,
      gap: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    scheduleInfo: {
      flex: 1,
      gap: 2,
    },
    scheduleTitle: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    scheduleMeta: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
    },
    scheduleBadge: {
      alignSelf: "flex-start" as const,
      marginTop: SPACING.xs,
      backgroundColor: n.background,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
    },
    scheduleBadgeText: {
      ...TYPOGRAPHY.caption,
      color: n.secondary,
    },
    scheduleNotes: {
      ...TYPOGRAPHY.bodySmall,
      color: n.muted,
      marginTop: SPACING.xs,
    },
    editButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: s.success,
    },
    filesList: {
      gap: SPACING.sm,
      marginTop: SPACING.sm,
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
    fileActions: {
      flexDirection: "row" as const,
      gap: SPACING.xs,
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
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
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
      refetchPrefs();
    }, [refetchFilesIfStale, refetchPrefs, refetchSchedulesIfStale])
  );

  useAutoRefetchOnReconnect(
    useCallback(() => {
      refetchSchedules();
      refetchFiles();
      refetchPrefs();
    }, [refetchFiles, refetchPrefs, refetchSchedules])
  );

  const handleRefresh = useCallback(async () => {
    if (refreshRef.current) return;
    refreshRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([Promise.resolve(refetchSchedules()), refetchFiles(), refetchPrefs()]);
    } finally {
      refreshRef.current = false;
      setRefreshing(false);
    }
  }, [refetchFiles, refetchPrefs, refetchSchedules]);

  const handleOpenWebSettings = useCallback(() => {
    if (!orgSlug) return;
    Linking.openURL(getWebPath(orgSlug, "calendar/my-settings"));
  }, [orgSlug]);

  const handleManageSources = useCallback(() => {
    if (!orgSlug) return;
    router.push(getScheduleSourcesPath(orgSlug));
  }, [orgSlug, router]);

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

  const handleDeleteFile = useCallback(
    (file: ScheduleFile) => {
      Alert.alert("Delete File", `Delete "${file.file_name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingFileId(file.id);
            const result = await deleteFile(file);
            setDeletingFileId(null);
            if (!result.success) {
              Alert.alert("Unable to delete file", result.error || "Please try again.");
              return;
            }
            showToast("File deleted", "success");
          },
        },
      ]);
    },
    [deleteFile]
  );

  const handleTogglePreference = useCallback(
    async (key: keyof typeof DEFAULT_CALENDAR_SYNC_PREFERENCES, value: boolean) => {
      const result = await updatePreferences({ [key]: value });
      if (!result.success) {
        showToast(result.error || "Unable to save sync settings", "error");
        return;
      }
      showToast(formatSyncStatus(value), "success");
    },
    [updatePreferences]
  );

  const error = schedulesError || filesError || prefsError;
  const isInitialLoad = schedulesLoading || filesLoading || prefsLoading;

  if (error && !isInitialLoad && mySchedules.length === 0 && myFiles.length === 0) {
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
                <Text style={styles.headerTitle}>My Schedule Settings</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <ErrorState onRetry={handleRefresh} title="Unable to load schedule settings" isOffline={isOffline} />
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
              <Text style={styles.headerTitle}>My Schedule Settings</Text>
              <Text style={styles.headerMeta}>
                {mySchedules.length} {mySchedules.length === 1 ? "schedule" : "schedules"} • {myFiles.length} {myFiles.length === 1 ? "file" : "files"}
              </Text>
            </View>
            {isAdmin ? (
              <Pressable onPress={handleManageSources} style={styles.manageSourcesButton}>
                <Text style={styles.manageSourcesText}>Sources</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {error ? (
            <View style={[styles.card, styles.noticeCard]}>
              <Text style={styles.noticeText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Calendar Sync Preferences</Text>
                <Text style={styles.sectionHint}>Choose which team event types should sync into your personal calendar connection.</Text>
              </View>
              {prefsSaving ? <ActivityIndicator size="small" /> : null}
            </View>
            <View style={styles.card}>
              {SYNC_LABELS.map((item, index) => (
                <View key={item.key} style={index === 0 ? undefined : styles.divider}>
                  <View style={styles.row}>
                    <View style={styles.switchInfo}>
                      <Text style={styles.switchLabel}>{item.label}</Text>
                      <Text style={styles.switchHint}>{item.hint}</Text>
                    </View>
                    <Switch
                      value={preferences[item.key]}
                      onValueChange={(value) => handleTogglePreference(item.key, value)}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>My Schedules</Text>
                <Text style={styles.sectionHint}>Manage your recurring class and availability blocks.</Text>
              </View>
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push(`/(app)/${orgSlug}/schedules/new`)}
              >
                <Plus size={16} color="#ffffff" />
                <Text style={styles.actionButtonText}>Add</Text>
              </Pressable>
            </View>
            <View style={styles.card}>
              {mySchedules.length === 0 ? (
                <View style={styles.emptyState}>
                  <BookOpen size={28} color={APP_CHROME.headerMeta} />
                  <Text style={styles.emptyTitle}>No schedules yet</Text>
                  <Text style={styles.emptyText}>
                    Add your class schedule so coaches can plan around your availability.
                  </Text>
                </View>
              ) : (
                mySchedules.map((schedule, index) => (
                  <View key={schedule.id} style={index === 0 ? styles.scheduleCard : [styles.scheduleCard, styles.divider]}>
                    <View style={styles.scheduleInfo}>
                      <Text style={styles.scheduleTitle}>{schedule.title}</Text>
                      <Text style={styles.scheduleMeta}>
                        {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                      </Text>
                      <View style={styles.scheduleBadge}>
                        <Text style={styles.scheduleBadgeText}>{formatOccurrence(schedule)}</Text>
                      </View>
                      {schedule.notes ? (
                        <Text style={styles.scheduleNotes} numberOfLines={2}>
                          {schedule.notes}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => router.push(`/(app)/${orgSlug}/schedules/${schedule.id}/edit`)}>
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Uploaded Schedule Files</Text>
                <Text style={styles.sectionHint}>Keep PDFs and screenshots handy for coaches and admins.</Text>
              </View>
              <ScheduleFileUpload onUpload={uploadFile} />
            </View>
            <View style={styles.card}>
              {myFiles.length === 0 ? (
                <View style={styles.emptyState}>
                  <FileText size={28} color={APP_CHROME.headerMeta} />
                  <Text style={styles.emptyTitle}>No uploaded files</Text>
                  <Text style={styles.emptyText}>
                    Upload a schedule PDF or screenshot so the team can reference it.
                  </Text>
                </View>
              ) : (
                <View style={styles.filesList}>
                  {myFiles.map((file) => (
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
                        <Text style={styles.fileMeta}>{formatFileSize(file.file_size)}</Text>
                      </View>
                      <View style={styles.fileActions}>
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
                        <Pressable
                          style={styles.iconButton}
                          onPress={() => handleDeleteFile(file)}
                          disabled={deletingFileId === file.id}
                        >
                          {deletingFileId === file.id ? (
                            <ActivityIndicator size="small" />
                          ) : (
                            <Trash2 size={16} color="#dc2626" />
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>External Calendar Connections</Text>
                <Text style={styles.sectionHint}>Google OAuth, ICS links, and advanced sync setup stay on web.</Text>
              </View>
              <CalendarSync size={20} color={APP_CHROME.gradientStart} />
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionHint}>
                Use the web settings page to connect Google Calendar, manage imported feeds, and complete advanced sync setup.
              </Text>
              <Pressable style={styles.secondaryButton} onPress={handleOpenWebSettings}>
                <ExternalLink size={16} color={APP_CHROME.gradientStart} />
                <Text style={styles.secondaryButtonText}>Open Web Sync Settings</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
