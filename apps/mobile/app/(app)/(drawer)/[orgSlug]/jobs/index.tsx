import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  Pressable,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { Briefcase, Plus, Search } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { useJobs } from "@/hooks/useJobs";
import { JobCard } from "@/components/jobs/JobCard";
import { SkeletonList } from "@/components/ui/Skeleton";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import type { LocationType, ExperienceLevel } from "@/types/jobs";
import type { JobPostingWithPoster } from "@/types/jobs";

const LOCATION_PILLS: { value: LocationType; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
];

const EXPERIENCE_PILLS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "executive", label: "Executive" },
];

export default function JobsScreen() {
  const { orgSlug, orgId, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();

  const [searchText, setSearchText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedLocationType, setSelectedLocationType] = useState<LocationType | undefined>(
    undefined
  );
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<
    ExperienceLevel | undefined
  >(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const isRefetchingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters = useMemo(
    () => ({
      query: debouncedQuery || undefined,
      location_type: selectedLocationType,
      experience_level: selectedExperienceLevel,
    }),
    [debouncedQuery, selectedLocationType, selectedExperienceLevel]
  );

  const { jobs, loading, error, canPost, refetch, refetchIfStale } = useJobs(orgId, filters);

  const styles = useMemo(() => createStyles(), []);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available — no-op
    }
  }, [navigation]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text.trim());
    }, 300);
  }, []);

  const toggleLocationPill = useCallback((value: LocationType) => {
    setSelectedLocationType((prev) => (prev === value ? undefined : value));
  }, []);

  const toggleExperiencePill = useCallback((value: ExperienceLevel) => {
    setSelectedExperienceLevel((prev) => (prev === value ? undefined : value));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refetchIfStale();
    }, [refetchIfStale])
  );

  const handleRefresh = useCallback(async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await refetch();
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  }, [refetch]);

  const handleJobPress = useCallback(
    (jobId: string) => {
      router.push(`/(app)/(drawer)/${orgSlug}/jobs/${jobId}`);
    },
    [router, orgSlug]
  );

  const handleCreateJob = useCallback(() => {
    router.push(`/(app)/(drawer)/${orgSlug}/jobs/new`);
  }, [router, orgSlug]);

  const renderJob = useCallback(
    ({ item }: { item: JobPostingWithPoster }) => (
      <JobCard
        job={item}
        onPress={() => handleJobPress(item.id)}
        style={styles.jobCard}
      />
    ),
    [handleJobPress, styles.jobCard]
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <Search size={16} color={NEUTRAL.muted} style={styles.searchIcon} />
          <TextInput
            value={searchText}
            onChangeText={handleSearchChange}
            placeholder="Search jobs..."
            placeholderTextColor={NEUTRAL.placeholder}
            style={styles.searchInput}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {/* Filter pills */}
        <View style={styles.pillSection}>
          <View style={styles.pillRow}>
            {LOCATION_PILLS.map((pill) => {
              const selected = selectedLocationType === pill.value;
              return (
                <Pressable
                  key={pill.value}
                  onPress={() => toggleLocationPill(pill.value)}
                  style={[styles.pill, selected && styles.pillSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                    {pill.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.pillRow}>
            {EXPERIENCE_PILLS.map((pill) => {
              const selected = selectedExperienceLevel === pill.value;
              return (
                <Pressable
                  key={pill.value}
                  onPress={() => toggleExperiencePill(pill.value)}
                  style={[styles.pill, selected && styles.pillSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                    {pill.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    ),
    [
      searchText,
      handleSearchChange,
      selectedLocationType,
      selectedExperienceLevel,
      toggleLocationPill,
      toggleExperiencePill,
      styles,
    ]
  );

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
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
          <View style={styles.headerContent}>
            {/* Org Logo (opens drawer) */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image
                  source={orgLogoUrl}
                  style={styles.orgLogo}
                  contentFit="contain"
                  transition={200}
                />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] ?? "?"}</Text>
                </View>
              )}
            </Pressable>

            {/* Title */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Jobs</Text>
              <Text style={styles.headerMeta}>
                {jobs.length} {jobs.length === 1 ? "posting" : "postings"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {loading && jobs.length === 0 ? (
          <View style={styles.loadingContainer}>
            <SkeletonList type="member" count={4} />
          </View>
        ) : (
          <FlatList
            data={jobs}
            keyExtractor={(item) => item.id}
            renderItem={renderJob}
            ListHeaderComponent={listHeader}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={SEMANTIC.success}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Briefcase size={48} color={NEUTRAL.border} />
                <Text style={styles.emptyTitle}>No jobs posted yet</Text>
                <Text style={styles.emptyText}>
                  {canPost
                    ? "Be the first to post a job opportunity."
                    : "Check back later for new opportunities."}
                </Text>
                {canPost && (
                  <Pressable
                    onPress={handleCreateJob}
                    style={styles.emptyCreateButton}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyCreateButtonText}>Post a Job</Text>
                  </Pressable>
                )}
              </View>
            }
            initialNumToRender={8}
            maxToRenderPerBatch={5}
            windowSize={7}
            removeClippedSubviews={true}
          />
        )}
      </View>

      {/* FAB — only visible when canPost */}
      {canPost && (
        <Pressable
          onPress={handleCreateJob}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          accessibilityLabel="Post a job"
          accessibilityRole="button"
        >
          <Plus size={24} color="#ffffff" />
        </Pressable>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    headerGradient: {
      paddingBottom: SPACING.md,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
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
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700",
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
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    listHeader: {
      gap: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      borderRadius: RADIUS.md,
      backgroundColor: NEUTRAL.background,
      paddingHorizontal: SPACING.sm,
      gap: SPACING.xs,
    },
    searchIcon: {},
    searchInput: {
      flex: 1,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
    },
    pillSection: {
      gap: SPACING.xs,
    },
    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    pill: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.surface,
    },
    pillSelected: {
      borderColor: SEMANTIC.success,
      backgroundColor: SEMANTIC.successLight,
    },
    pillText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.secondary,
    },
    pillTextSelected: {
      color: SEMANTIC.successDark,
      fontWeight: "600",
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 100,
      flexGrow: 1,
    },
    jobCard: {
      marginBottom: SPACING.sm,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 64,
      gap: SPACING.sm,
    },
    emptyTitle: {
      ...TYPOGRAPHY.headlineMedium,
      color: NEUTRAL.foreground,
      marginTop: SPACING.sm,
    },
    emptyText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.muted,
      textAlign: "center",
      paddingHorizontal: SPACING.xl,
    },
    emptyCreateButton: {
      marginTop: SPACING.sm,
      backgroundColor: NEUTRAL.foreground,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
    },
    emptyCreateButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.surface,
      fontWeight: "600",
    },
    fab: {
      position: "absolute",
      bottom: SPACING.xl,
      right: SPACING.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: SEMANTIC.success,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 6,
    },
    fabPressed: {
      opacity: 0.85,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
      backgroundColor: NEUTRAL.background,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
      textAlign: "center",
    },
  });
