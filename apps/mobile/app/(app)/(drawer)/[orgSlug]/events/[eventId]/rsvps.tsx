import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, User, Check, HelpCircle, X } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, RSVP_COLORS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

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
    icon: <Check size={16} color={RSVP_COLORS.going.text} />,
    colors: RSVP_COLORS.going,
  },
  maybe: {
    label: "Maybe",
    icon: <HelpCircle size={16} color={RSVP_COLORS.maybe.text} />,
    colors: RSVP_COLORS.maybe,
  },
  not_attending: {
    label: "Can't Go",
    icon: <X size={16} color={RSVP_COLORS.declined.text} />,
    colors: RSVP_COLORS.declined,
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

  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const handleBack = () => {
    router.back();
  };

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
            <User size={20} color={NEUTRAL.muted} />
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
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>RSVPs</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={SEMANTIC.success} />
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
              </Pressable>
              <Text style={styles.headerTitle}>RSVPs</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              onPress={fetchRSVPs}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
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
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>RSVPs</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        {/* Event Title */}
        {eventInfo && (
          <View style={styles.eventTitleContainer}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {eventInfo.title}
            </Text>
          </View>
        )}

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          {FILTER_OPTIONS.map((option) => {
            const isSelected = filter === option.value;
            const count = counts[option.value];
            return (
              <Pressable
                key={option.value}
                style={({ pressed }) => [
                  styles.filterTab,
                  isSelected && styles.filterTabSelected,
                  pressed && styles.filterTabPressed,
                ]}
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
              tintColor={SEMANTIC.success}
            />
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {},
  headerSafeArea: {},
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: APP_CHROME.headerTitle,
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  contentSheet: {
    flex: 1,
    backgroundColor: NEUTRAL.surface,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
  },
  eventTitleContainer: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  eventTitle: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
  },
  filterContainer: {
    flexDirection: "row",
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  filterTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: NEUTRAL.background,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  filterTabSelected: {
    backgroundColor: SEMANTIC.success,
    borderColor: SEMANTIC.success,
  },
  filterTabPressed: {
    opacity: 0.7,
  },
  filterText: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.secondary,
  },
  filterTextSelected: {
    color: "#ffffff",
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: NEUTRAL.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countBadgeSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  countText: {
    ...TYPOGRAPHY.labelSmall,
    fontSize: 11,
    color: NEUTRAL.secondary,
  },
  countTextSelected: {
    color: "#ffffff",
  },
  listContent: {
    padding: SPACING.md,
    paddingTop: 0,
    gap: SPACING.sm,
    flexGrow: 1,
  },
  rsvpCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  avatarContainer: {
    marginRight: SPACING.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: NEUTRAL.background,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  rsvpName: {
    ...TYPOGRAPHY.titleSmall,
    color: NEUTRAL.foreground,
  },
  rsvpEmail: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  statusText: {
    ...TYPOGRAPHY.labelSmall,
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.xs,
  },
  emptySubtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: NEUTRAL.muted,
    textAlign: "center",
  },
  errorText: {
    ...TYPOGRAPHY.bodyMedium,
    color: SEMANTIC.error,
    textAlign: "center",
    marginBottom: SPACING.md,
  },
  retryButton: {
    backgroundColor: SEMANTIC.success,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  retryButtonPressed: {
    opacity: 0.9,
  },
  retryButtonText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#ffffff",
  },
});
