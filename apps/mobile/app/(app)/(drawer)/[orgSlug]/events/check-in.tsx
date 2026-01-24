import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Image,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import {
  ArrowLeft,
  Search,
  UserCheck,
  UserX,
  Calendar,
  MapPin,
  Users,
  Check,
  X,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEventRSVPs, type EventRSVP } from "@/hooks/useEventRSVPs";
import type { Event } from "@/hooks/useEvents";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS, SHADOWS, AVATAR_SIZES } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type FilterMode = "all" | "attending" | "checked_in" | "not_checked_in";

export default function CheckInScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgSlug, orgName, orgLogoUrl, orgId } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const styles = useMemo(() => createStyles(), []);

  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("attending");

  const {
    rsvps,
    loading: rsvpsLoading,
    error: rsvpsError,
    checkInAttendee,
    undoCheckIn,
    attendingCount,
    checkedInCount,
  } = useEventRSVPs(eventId);

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

  // Fetch event details
  useEffect(() => {
    async function fetchEvent() {
      if (!eventId || !orgId) return;

      try {
        setEventLoading(true);
        const { data, error: eventError } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .single();

        if (eventError) throw eventError;
        setEvent(data as Event);
      } catch (e) {
        setEventError((e as Error).message);
      } finally {
        setEventLoading(false);
      }
    }

    fetchEvent();
  }, [eventId, orgId]);

  // Filter RSVPs based on search and filter mode
  const filteredRsvps = useMemo(() => {
    let filtered = rsvps;

    // Apply filter mode
    switch (filterMode) {
      case "attending":
        filtered = filtered.filter((r) => r.status === "attending");
        break;
      case "checked_in":
        filtered = filtered.filter((r) => r.checked_in_at !== null);
        break;
      case "not_checked_in":
        filtered = filtered.filter(
          (r) => r.status === "attending" && r.checked_in_at === null
        );
        break;
      default:
        break;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((r) => {
        const name = r.user?.name?.toLowerCase() || "";
        const email = r.user?.email?.toLowerCase() || "";
        return name.includes(query) || email.includes(query);
      });
    }

    return filtered;
  }, [rsvps, filterMode, searchQuery]);

  const handleCheckIn = async (rsvp: EventRSVP) => {
    const result = await checkInAttendee(rsvp.id);
    if (!result.success) {
      Alert.alert("Error", result.error || "Failed to check in attendee");
    }
  };

  const handleUndoCheckIn = async (rsvp: EventRSVP) => {
    Alert.alert(
      "Undo Check-In",
      `Are you sure you want to undo the check-in for ${rsvp.user?.name || rsvp.user?.email}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo",
          style: "destructive",
          onPress: async () => {
            const result = await undoCheckIn(rsvp.id);
            if (!result.success) {
              Alert.alert("Error", result.error || "Failed to undo check-in");
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const formatCheckInTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const renderAttendeeCard = ({ item }: { item: EventRSVP }) => {
    const isCheckedIn = item.checked_in_at !== null;
    const displayName = item.user?.name || item.user?.email || "Unknown User";
    const initials = displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    return (
      <View style={[styles.attendeeCard, isCheckedIn && styles.attendeeCardCheckedIn]}>
        <View style={styles.attendeeInfo}>
          {item.user?.avatar_url ? (
            <Image source={{ uri: item.user.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, isCheckedIn && styles.avatarCheckedIn]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={styles.attendeeDetails}>
            <Text style={styles.attendeeName} numberOfLines={1}>
              {displayName}
            </Text>
            {item.user?.email && item.user.name && (
              <Text style={styles.attendeeEmail} numberOfLines={1}>
                {item.user.email}
              </Text>
            )}
            {isCheckedIn && item.checked_in_at && (
              <View style={styles.checkedInBadge}>
                <Check size={12} color={SEMANTIC.success} />
                <Text style={styles.checkedInTime}>
                  Checked in at {formatCheckInTime(item.checked_in_at)}
                </Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.checkInButton, isCheckedIn && styles.undoButton]}
          onPress={() => (isCheckedIn ? handleUndoCheckIn(item) : handleCheckIn(item))}
        >
          {isCheckedIn ? (
            <X size={20} color={SEMANTIC.error} />
          ) : (
            <UserCheck size={20} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Users size={40} color={NEUTRAL.muted} />
      <Text style={styles.emptyTitle}>
        {searchQuery ? "No matching attendees" : "No attendees found"}
      </Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery
          ? "Try a different search term"
          : filterMode === "attending"
          ? "No one has RSVP'd as attending yet"
          : filterMode === "checked_in"
          ? "No one has been checked in yet"
          : "No attendees to check in"}
      </Text>
    </View>
  );

  // Access control - redirect non-admins
  if (!roleLoading && !isAdmin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>You don't have permission to check in attendees</Text>
        <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonTextLarge}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const loading = eventLoading || rsvpsLoading || roleLoading;
  const error = eventError || rsvpsError;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={SEMANTIC.success} />
        <Text style={styles.loadingText}>Loading check-in...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonTextLarge}>Go Back</Text>
        </TouchableOpacity>
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
            {/* Back button */}
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
            </TouchableOpacity>

            {/* Header text */}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Check-In</Text>
              <Text style={styles.headerMeta}>
                {checkedInCount} / {attendingCount} checked in
              </Text>
            </View>

            {/* Logo for drawer toggle */}
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        {/* Event Info Card */}
        {event && (
          <View style={styles.eventCard}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title}
            </Text>
            <View style={styles.eventDetails}>
              <View style={styles.eventDetailRow}>
                <Calendar size={14} color={NEUTRAL.muted} />
                <Text style={styles.eventDetailText}>
                  {formatDate(event.start_date)} at {formatTime(event.start_date)}
                </Text>
              </View>
              {event.location && (
                <View style={styles.eventDetailRow}>
                  <MapPin size={14} color={NEUTRAL.muted} />
                  <Text style={styles.eventDetailText} numberOfLines={1}>
                    {event.location}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Search size={18} color={NEUTRAL.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor={NEUTRAL.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <X size={18} color={NEUTRAL.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          {(
            [
              { key: "attending", label: "Attending" },
              { key: "not_checked_in", label: "Pending" },
              { key: "checked_in", label: "Checked In" },
              { key: "all", label: "All" },
            ] as const
          ).map((filter) => (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterTab, filterMode === filter.key && styles.filterTabActive]}
              onPress={() => setFilterMode(filter.key)}
            >
              <Text
                style={[
                  styles.filterTabText,
                  filterMode === filter.key && styles.filterTabTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Attendee List */}
        <FlatList
          data={filteredRsvps}
          renderItem={renderAttendeeCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SPACING.lg,
      backgroundColor: NEUTRAL.background,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.secondary,
      marginTop: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: SEMANTIC.error,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    backButtonLarge: {
      backgroundColor: SEMANTIC.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
    },
    backButtonTextLarge: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    // Header styles
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
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
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
    // Content sheet
    contentSheet: {
      flex: 1,
      backgroundColor: NEUTRAL.surface,
    },
    // Event card
    eventCard: {
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.md,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      ...SHADOWS.sm,
    },
    eventTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginBottom: SPACING.sm,
    },
    eventDetails: {
      gap: SPACING.xs,
    },
    eventDetailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
    },
    eventDetailText: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      flex: 1,
    },
    // Search
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: NEUTRAL.background,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      paddingHorizontal: SPACING.sm,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      height: 44,
      gap: SPACING.sm,
    },
    searchInput: {
      flex: 1,
      ...TYPOGRAPHY.bodyMedium,
      color: NEUTRAL.foreground,
      paddingVertical: 0,
    },
    // Filter tabs
    filterContainer: {
      flexDirection: "row",
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: 2,
    },
    filterTab: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center",
      borderRadius: RADIUS.sm,
    },
    filterTabActive: {
      backgroundColor: SEMANTIC.success,
    },
    filterTabText: {
      ...TYPOGRAPHY.labelSmall,
      color: NEUTRAL.muted,
    },
    filterTabTextActive: {
      color: "#ffffff",
      fontWeight: "600",
    },
    // List
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    // Attendee card
    attendeeCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: NEUTRAL.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: NEUTRAL.border,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    attendeeCardCheckedIn: {
      borderColor: SEMANTIC.successLight,
      backgroundColor: `${SEMANTIC.successLight}30`,
    },
    attendeeInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      gap: SPACING.sm,
    },
    avatar: {
      width: AVATAR_SIZES.md,
      height: AVATAR_SIZES.md,
      borderRadius: AVATAR_SIZES.md / 2,
    },
    avatarPlaceholder: {
      width: AVATAR_SIZES.md,
      height: AVATAR_SIZES.md,
      borderRadius: AVATAR_SIZES.md / 2,
      backgroundColor: NEUTRAL.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarCheckedIn: {
      backgroundColor: SEMANTIC.successLight,
    },
    avatarText: {
      ...TYPOGRAPHY.labelMedium,
      color: NEUTRAL.foreground,
    },
    attendeeDetails: {
      flex: 1,
    },
    attendeeName: {
      ...TYPOGRAPHY.titleSmall,
      color: NEUTRAL.foreground,
    },
    attendeeEmail: {
      ...TYPOGRAPHY.caption,
      color: NEUTRAL.muted,
      marginTop: 2,
    },
    checkedInBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 4,
    },
    checkedInTime: {
      ...TYPOGRAPHY.caption,
      color: SEMANTIC.success,
    },
    checkInButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: SEMANTIC.success,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: SPACING.sm,
    },
    undoButton: {
      backgroundColor: SEMANTIC.errorLight,
    },
    // Empty state
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: SPACING.xxl,
      paddingHorizontal: SPACING.md,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: NEUTRAL.foreground,
      marginTop: SPACING.md,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: NEUTRAL.secondary,
      textAlign: "center",
      marginTop: SPACING.xs,
    },
  });
