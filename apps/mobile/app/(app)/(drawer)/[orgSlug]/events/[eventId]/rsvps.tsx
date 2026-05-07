import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, User, Check, HelpCircle, X } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";
import { SPACING, RADIUS, RSVP_COLORS, SHADOWS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";

type RSVPStatus = "attending" | "not_attending" | "maybe";
type FilterStatus = "all" | RSVPStatus;

interface RSVP {
  id: string;
  user_id: string;
  status: RSVPStatus;
  created_at: string | null;
  users: {
    name: string | null;
    email: string | null;
  } | null;
}

interface EventInfo {
  title: string;
}

const STATUS_CONFIG: Record<RSVPStatus, { label: string; icon: React.ReactNode; colors: { background: string; text: string; border: string } }> = {
  attending: {
    label: "Going",
    icon: <Check size={16} color={RSVP_COLORS.attending.text} />,
    colors: RSVP_COLORS.attending,
  },
  maybe: {
    label: "Maybe",
    icon: <HelpCircle size={16} color={RSVP_COLORS.maybe.text} />,
    colors: RSVP_COLORS.maybe,
  },
  not_attending: {
    label: "Can't Go",
    icon: <X size={16} color={RSVP_COLORS.not_attending.text} />,
    colors: RSVP_COLORS.not_attending,
  },
};

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attending", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "not_attending", label: "Can't Go" },
];

export default function RSVPsScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgId } = useOrg();
  const router = useRouter();
  const { colors } = useOrgTheme();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useMemo(() => createStyles(colors, neutral, semantic), [colors, neutral, semantic]);

  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const fetchRSVPs = useCallback(async () => {
    if (!eventId || !orgId) return;

    try {
      // Fetch event info
      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select("title")
        .eq("id", eventId)
        .eq("organization_id", orgId)
        .single();

      if (eventError) throw eventError;
      setEventInfo(eventData);

      // Fetch RSVPs
      const { data: rsvpData, error: rsvpError } = await supabase
        .from("event_rsvps")
        .select("id, user_id, status, created_at, users(name, email)")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

      if (rsvpError) throw rsvpError;
      setRsvps((rsvpData as unknown as RSVP[]) || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, orgId]);

  useEffect(() => {
    fetchRSVPs();
  }, [fetchRSVPs]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRSVPs();
  }, [fetchRSVPs]);

  // Filter RSVPs based on selected filter
  const filteredRsvps = useMemo(() => {
    if (filter === "all") return rsvps;
    return rsvps.filter((r) => r.status === filter);
  }, [rsvps, filter]);

  // Count by status
  const counts = useMemo(() => {
    return {
      all: rsvps.length,
      attending: rsvps.filter((r) => r.status === "attending").length,
      maybe: rsvps.filter((r) => r.status === "maybe").length,
      not_attending: rsvps.filter((r) => r.status === "not_attending").length,
    };
  }, [rsvps]);

  const renderRSVPItem = ({ item }: { item: RSVP }) => {
    const user = item.users;
    const displayName = user?.name || user?.email || "Unknown User";
    const config = STATUS_CONFIG[item.status];

    return (
      <View style={styles.rsvpCard}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <User size={20} color={neutral.muted} />
          </View>
        </View>
        <View style={styles.rsvpInfo}>
          <Text style={styles.rsvpName} numberOfLines={1}>
            {displayName}
          </Text>
          {user?.email && user.name && (
            <Text style={styles.rsvpEmail} numberOfLines={1}>
              {user.email}
            </Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: config.colors.background }]}>
          {config.icon}
          <Text style={[styles.statusText, { color: config.colors.text }]}>
            {config.label}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>
        {filter === "all" ? "No RSVPs yet" : `No ${FILTER_OPTIONS.find(o => o.value === filter)?.label} responses`}
      </Text>
      <Text style={styles.emptySubtitle}>
        {filter === "all"
          ? "People who RSVP will appear here"
          : "Try selecting a different filter"}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={fetchRSVPs}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={20} color={colors.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>

      {/* Event Title */}
      {eventInfo && (
        <Text style={styles.eventTitle} numberOfLines={2}>
          {eventInfo.title}
        </Text>
      )}

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {FILTER_OPTIONS.map((option) => {
          const isSelected = filter === option.value;
          const count = counts[option.value];
          return (
            <Pressable
              key={option.value}
              style={[styles.filterTab, isSelected && styles.filterTabSelected]}
              onPress={() => setFilter(option.value)}
            >
              <Text style={[styles.filterText, isSelected && styles.filterTextSelected]}>
                {option.label}
              </Text>
              <View style={[styles.countBadge, isSelected && styles.countBadgeSelected]}>
                <Text style={[styles.countText, isSelected && styles.countTextSelected]}>
                  {count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* RSVP List */}
      <FlatList
        data={filteredRsvps}
        renderItem={renderRSVPItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors, neutral: NeutralColors, semantic: SemanticColors) => ({
  container: {
    flex: 1,
    backgroundColor: neutral.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: SPACING.lg,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  backButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: SPACING.sm,
  },
  backButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: colors.primary,
  },
  eventTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: neutral.foreground,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  filterContainer: {
    flexDirection: "row" as const,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  filterTab: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: neutral.surface,
    borderWidth: 1,
    borderColor: neutral.border,
  },
  filterTabSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    ...TYPOGRAPHY.labelSmall,
    color: neutral.secondary,
  },
  filterTextSelected: {
    color: colors.primaryForeground || "#ffffff",
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: neutral.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 6,
  },
  countBadgeSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  countText: {
    ...TYPOGRAPHY.labelSmall,
    fontSize: 11,
    color: neutral.secondary,
  },
  countTextSelected: {
    color: colors.primaryForeground || "#ffffff",
  },
  listContent: {
    padding: SPACING.md,
    paddingTop: 0,
    gap: SPACING.sm,
    flexGrow: 1,
  },
  rsvpCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: neutral.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: neutral.border,
    ...SHADOWS.sm,
  },
  avatarContainer: {
    marginRight: SPACING.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: neutral.divider,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  rsvpInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  rsvpName: {
    ...TYPOGRAPHY.titleSmall,
    color: neutral.foreground,
  },
  rsvpEmail: {
    ...TYPOGRAPHY.caption,
    color: neutral.muted,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  statusText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: "600" as const,
  },
  emptyState: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: SPACING.xl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: neutral.foreground,
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: neutral.muted,
    textAlign: "center" as const,
  },
  errorText: {
    ...TYPOGRAPHY.bodyMedium,
    color: semantic.error,
    textAlign: "center" as const,
    marginBottom: SPACING.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  retryButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: colors.primaryForeground || "#ffffff",
  },
});
