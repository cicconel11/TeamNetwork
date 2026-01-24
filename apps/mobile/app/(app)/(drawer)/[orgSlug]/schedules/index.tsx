import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Pressable,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import {
  BookOpen,
  ExternalLink,
  Plus,
  FileText,
  ImageIcon,
  Trash2,
  Eye,
} from "lucide-react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useAuth } from "@/hooks/useAuth";
import { useSchedules, formatOccurrence, formatTime } from "@/hooks/useSchedules";
import { useScheduleFiles } from "@/hooks/useScheduleFiles";
import { OverflowMenu, type OverflowMenuItem } from "@/components/OverflowMenu";
import { AvailabilityGrid } from "@/components/schedules/AvailabilityGrid";
import { ScheduleFileUpload } from "@/components/schedules/ScheduleFileUpload";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import type { AcademicSchedule, ScheduleFile } from "@teammeet/types";

// Local colors for schedules screen
const SCHEDULES_COLORS = {
  background: "#ffffff",
  sectionBackground: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBg: "#fee2e2",
  badgeBg: "#f1f5f9",
  badgeText: "#475569",
};

type FileTab = "my" | "all";

export default function SchedulesScreen() {
  const { orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { isAdmin, permissions } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);

  const {
    mySchedules,
    allSchedules,
    totalMembers,
    loading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
    refetchIfStale: refetchSchedulesIfStale,
  } = useSchedules(orgSlug || "", user?.id, isAdmin);

  const {
    myFiles,
    allFiles,
    loading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
    refetchIfStale: refetchFilesIfStale,
    uploadFile,
    deleteFile,
    getSignedUrl,
  } = useScheduleFiles(orgSlug || "", user?.id, isAdmin);

  const [refreshing, setRefreshing] = useState(false);
  const [fileTab, setFileTab] = useState<FileTab>("my");
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [viewingFileId, setViewingFileId] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);

  // Safe drawer toggle
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);

  // Admin overflow menu items
  const adminMenuItems: OverflowMenuItem[] = useMemo(() => {
    if (!permissions.canUseAdminActions) return [];

    return [
      {
        id: "open-in-web",
        label: "Open in Web",
        icon: <ExternalLink size={20} color={SCHEDULES_COLORS.primaryCTA} />,
        onPress: () => {
          const webUrl = `https://www.myteamnetwork.com/${orgSlug}/schedules`;
          Linking.openURL(webUrl);
        },
      },
    ];
  }, [permissions.canUseAdminActions, orgSlug]);

  // Refetch on screen focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchSchedulesIfStale();
      refetchFilesIfStale();
    }, [refetchSchedulesIfStale, refetchFilesIfStale])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await Promise.all([refetchSchedules(), refetchFiles()]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetchSchedules, refetchFiles]);

  const handleAddSchedule = useCallback(() => {
    router.push(`/(app)/${orgSlug}/schedules/new`);
  }, [router, orgSlug]);

  const handleEditSchedule = useCallback(
    (scheduleId: string) => {
      router.push(`/(app)/${orgSlug}/schedules/${scheduleId}/edit`);
    },
    [router, orgSlug]
  );

  const handleViewFile = useCallback(
    async (file: ScheduleFile) => {
      setViewingFileId(file.id);
      try {
        const url = await getSignedUrl(file.file_path);
        if (url) {
          await WebBrowser.openBrowserAsync(url);
        } else {
          Alert.alert("Error", "Failed to get file URL");
        }
      } catch {
        Alert.alert("Error", "Failed to open file");
      } finally {
        setViewingFileId(null);
      }
    },
    [getSignedUrl]
  );

  const handleDeleteFile = useCallback(
    async (file: ScheduleFile) => {
      Alert.alert("Delete File", `Delete "${file.file_name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingFileId(file.id);
            const result = await deleteFile(file);
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to delete file");
            }
            setDeletingFileId(null);
          },
        },
      ]);
    },
    [deleteFile]
  );

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const headerSubtitle = useMemo(() => {
    return `${mySchedules.length} ${mySchedules.length === 1 ? "schedule" : "schedules"}`;
  }, [mySchedules.length]);

  const displayedFiles = fileTab === "all" && isAdmin ? allFiles : myFiles;

  const error = schedulesError || filesError;

  if (error) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.navHeader}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "S"}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Schedules</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading schedules: {error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.navHeader}>
            {/* Logo */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "S"}</Text>
                </View>
              )}
            </Pressable>

            {/* Text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Schedules</Text>
              <Text style={styles.headerMeta}>{headerSubtitle}</Text>
            </View>

            {/* Admin menu */}
            {adminMenuItems.length > 0 && (
              <OverflowMenu items={adminMenuItems} accessibilityLabel="Schedule options" />
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={SCHEDULES_COLORS.primaryCTA}
          />
        }
      >
        {/* My Schedules Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Schedules</Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddSchedule}>
              <Plus size={16} color={SCHEDULES_COLORS.primaryCTAText} />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {mySchedules.length > 0 ? (
            <View style={styles.schedulesList}>
              {mySchedules.map((schedule) => (
                <View key={schedule.id} style={styles.scheduleCard}>
                  <View style={styles.scheduleInfo}>
                    <Text style={styles.scheduleTitle}>{schedule.title}</Text>
                    <Text style={styles.scheduleTime}>
                      {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                    </Text>
                    <View style={styles.badgeContainer}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{formatOccurrence(schedule)}</Text>
                      </View>
                    </View>
                    {schedule.notes && (
                      <Text style={styles.scheduleNotes} numberOfLines={2}>
                        {schedule.notes}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => handleEditSchedule(schedule.id)}
                  >
                    <Text style={styles.editButtonText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <BookOpen size={32} color={SCHEDULES_COLORS.mutedText} />
              <Text style={styles.emptyTitle}>No schedules yet</Text>
              <Text style={styles.emptySubtitle}>
                Add your class schedules so coaches can plan around your availability.
              </Text>
              <TouchableOpacity style={styles.emptyButton} onPress={handleAddSchedule}>
                <Text style={styles.emptyButtonText}>Add Schedule</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Uploaded Files Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Uploaded Schedules</Text>
            <ScheduleFileUpload onUpload={uploadFile} />
          </View>

          {isAdmin && (
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tab, fileTab === "my" && styles.tabActive]}
                onPress={() => setFileTab("my")}
              >
                <Text style={[styles.tabText, fileTab === "my" && styles.tabTextActive]}>
                  My Files
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, fileTab === "all" && styles.tabActive]}
                onPress={() => setFileTab("all")}
              >
                <Text style={[styles.tabText, fileTab === "all" && styles.tabTextActive]}>
                  All Team Files
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.filesCard}>
            {displayedFiles.length > 0 ? (
              <View style={styles.filesList}>
                {displayedFiles.map((file) => (
                  <View key={file.id} style={styles.fileItem}>
                    <View style={styles.fileIcon}>
                      {file.mime_type?.startsWith("image/") ? (
                        <ImageIcon size={18} color={SCHEDULES_COLORS.secondaryText} />
                      ) : (
                        <FileText size={18} color={SCHEDULES_COLORS.secondaryText} />
                      )}
                    </View>
                    <View style={styles.fileInfo}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {file.file_name}
                      </Text>
                      <Text style={styles.fileMeta}>
                        {formatFileSize(file.file_size)}
                        {isAdmin && fileTab === "all" && "users" in file && file.users ? (
                          <Text> • {String((file.users as { name?: string | null; email?: string | null }).name || (file.users as { name?: string | null; email?: string | null }).email || "")}</Text>
                        ) : null}
                        {file.created_at && (
                          <Text> • {new Date(file.created_at).toLocaleDateString()}</Text>
                        )}
                      </Text>
                    </View>
                    <View style={styles.fileActions}>
                      <TouchableOpacity
                        style={styles.fileActionButton}
                        onPress={() => handleViewFile(file)}
                        disabled={viewingFileId === file.id}
                      >
                        <Eye
                          size={18}
                          color={
                            viewingFileId === file.id
                              ? SCHEDULES_COLORS.mutedText
                              : SCHEDULES_COLORS.primaryCTA
                          }
                        />
                      </TouchableOpacity>
                      {(fileTab === "my" || !isAdmin) && (
                        <TouchableOpacity
                          style={styles.fileActionButton}
                          onPress={() => handleDeleteFile(file)}
                          disabled={deletingFileId === file.id}
                        >
                          <Trash2
                            size={18}
                            color={
                              deletingFileId === file.id
                                ? SCHEDULES_COLORS.mutedText
                                : SCHEDULES_COLORS.error
                            }
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noFilesText}>No files uploaded yet.</Text>
            )}
          </View>
        </View>

        {/* Team Availability Section (Admin Only) */}
        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Team Availability</Text>
            <View style={styles.gridCard}>
              <AvailabilityGrid schedules={allSchedules} totalMembers={totalMembers} />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: SCHEDULES_COLORS.background,
    },
    // Header styles
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {},
    navHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
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
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    // Content
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    // Sections
    section: {
      marginBottom: spacing.lg,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: SCHEDULES_COLORS.primaryText,
    },
    // Add button
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: SCHEDULES_COLORS.primaryCTA,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
    },
    addButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.primaryCTAText,
    },
    // Schedules list
    schedulesList: {
      gap: spacing.sm,
    },
    scheduleCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      backgroundColor: SCHEDULES_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: SCHEDULES_COLORS.border,
      padding: spacing.md,
    },
    scheduleInfo: {
      flex: 1,
      marginRight: spacing.sm,
    },
    scheduleTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.primaryText,
    },
    scheduleTime: {
      fontSize: fontSize.sm,
      color: SCHEDULES_COLORS.secondaryText,
      marginTop: 2,
    },
    badgeContainer: {
      flexDirection: "row",
      marginTop: spacing.sm,
    },
    badge: {
      backgroundColor: SCHEDULES_COLORS.badgeBg,
      paddingVertical: 2,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
    },
    badgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.badgeText,
    },
    scheduleNotes: {
      fontSize: fontSize.sm,
      color: SCHEDULES_COLORS.mutedText,
      marginTop: spacing.sm,
    },
    editButton: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    editButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.primaryCTA,
    },
    // Empty state
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
      backgroundColor: SCHEDULES_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: SCHEDULES_COLORS.border,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: SCHEDULES_COLORS.primaryText,
      marginTop: spacing.md,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: SCHEDULES_COLORS.secondaryText,
      textAlign: "center",
      marginTop: spacing.xs,
      marginBottom: spacing.md,
    },
    emptyButton: {
      backgroundColor: SCHEDULES_COLORS.primaryCTA,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
    },
    emptyButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.primaryCTAText,
    },
    // File tabs
    tabContainer: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    tab: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: SCHEDULES_COLORS.sectionBackground,
    },
    tabActive: {
      backgroundColor: SCHEDULES_COLORS.primaryCTA,
    },
    tabText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.secondaryText,
    },
    tabTextActive: {
      color: SCHEDULES_COLORS.primaryCTAText,
    },
    // Files card
    filesCard: {
      backgroundColor: SCHEDULES_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: SCHEDULES_COLORS.border,
      padding: spacing.md,
    },
    filesList: {
      gap: spacing.sm,
    },
    fileItem: {
      flexDirection: "row",
      alignItems: "center",
      padding: spacing.sm,
      backgroundColor: SCHEDULES_COLORS.sectionBackground,
      borderRadius: borderRadius.md,
    },
    fileIcon: {
      marginRight: spacing.sm,
    },
    fileInfo: {
      flex: 1,
    },
    fileName: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: SCHEDULES_COLORS.primaryText,
    },
    fileMeta: {
      fontSize: fontSize.xs,
      color: SCHEDULES_COLORS.mutedText,
      marginTop: 2,
    },
    fileActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    fileActionButton: {
      padding: spacing.xs,
    },
    noFilesText: {
      fontSize: fontSize.sm,
      color: SCHEDULES_COLORS.mutedText,
    },
    // Grid card
    gridCard: {
      backgroundColor: SCHEDULES_COLORS.card,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: SCHEDULES_COLORS.border,
      padding: spacing.md,
    },
    // Error state
    errorContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.md,
    },
    errorText: {
      color: SCHEDULES_COLORS.error,
      textAlign: "center",
      fontSize: fontSize.base,
    },
  });
