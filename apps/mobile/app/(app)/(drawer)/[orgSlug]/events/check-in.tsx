import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import { Image } from "expo-image";
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
  QrCode,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useEventRSVPs, type EventRSVP } from "@/hooks/useEventRSVPs";
import type { Event } from "@/hooks/useEvents";
import { APP_CHROME } from "@/lib/chrome";
import { SPACING, RADIUS, SHADOWS, AVATAR_SIZES } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { formatShortWeekdayDate, formatTime } from "@/lib/date-format";
type FilterMode = "all" | "attending" | "checked_in" | "not_checked_in";

export default function CheckInScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgSlug, orgName, orgLogoUrl, orgId } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const { isAdmin, isLoading: roleLoading } = useOrgRole();
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n, s) => ({
    container: {
      flex: 1,
      backgroundColor: n.surface,
    },
    centered: {
      flex: 1,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
      backgroundColor: n.background,
    },
    loadingText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
      marginTop: SPACING.md,
    },
    errorText: {
      ...TYPOGRAPHY.bodyMedium,
      color: s.error,
      textAlign: "center" as const,
      marginBottom: SPACING.md,
    },
    backButtonLarge: {
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.lg,
    },
    backButtonTextLarge: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
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
    backButton: {
      width: 36,
      height: 36,
      alignItems: "center" as const,
      justifyContent: "center" as const,
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
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    orgAvatarText: {
      ...TYPOGRAPHY.titleSmall,
      fontWeight: "700" as const,
      color: APP_CHROME.avatarText,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: n.surface,
    },
    eventCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      ...SHADOWS.sm,
    },
    eventTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginBottom: SPACING.sm,
    },
    eventDetails: {
      gap: SPACING.xs,
    },
    eventDetailRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
    },
    eventDetailText: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
    },
    searchContainer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      backgroundColor: n.background,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      paddingHorizontal: SPACING.sm,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      height: 44,
      gap: SPACING.sm,
    },
    searchInput: {
      flex: 1,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      paddingVertical: 0,
    },
    scanButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.sm,
      paddingVertical: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: s.success,
    },
    scanButtonText: {
      ...TYPOGRAPHY.labelLarge,
      color: "#ffffff",
    },
    filterContainer: {
      flexDirection: "row" as const,
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      marginBottom: SPACING.sm,
      backgroundColor: n.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      padding: 2,
    },
    filterTab: {
      flex: 1,
      paddingVertical: SPACING.sm,
      alignItems: "center" as const,
      borderRadius: RADIUS.sm,
    },
    filterTabActive: {
      backgroundColor: s.success,
    },
    filterTabText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
    },
    filterTabTextActive: {
      color: "#ffffff",
      fontWeight: "600" as const,
    },
    listContent: {
      padding: SPACING.md,
      paddingBottom: 40,
      flexGrow: 1,
    },
    attendeeCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      marginBottom: SPACING.sm,
      ...SHADOWS.sm,
    },
    attendeeCardCheckedIn: {
      borderColor: s.successLight,
      backgroundColor: `${s.successLight}30`,
    },
    attendeeInfo: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
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
      backgroundColor: n.border,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    avatarCheckedIn: {
      backgroundColor: s.successLight,
    },
    avatarText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
    },
    attendeeDetails: {
      flex: 1,
    },
    attendeeName: {
      ...TYPOGRAPHY.titleSmall,
      color: n.foreground,
    },
    attendeeEmail: {
      ...TYPOGRAPHY.caption,
      color: n.muted,
      marginTop: 2,
    },
    checkedInBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      marginTop: 4,
    },
    checkedInTime: {
      ...TYPOGRAPHY.caption,
      color: s.success,
    },
    checkInButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: s.success,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      marginLeft: SPACING.sm,
    },
    undoButton: {
      backgroundColor: s.errorLight,
    },
    emptyState: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      paddingVertical: SPACING.xxl,
      paddingHorizontal: SPACING.md,
    },
    emptyTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      marginTop: SPACING.md,
    },
    emptySubtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      textAlign: "center" as const,
      marginTop: SPACING.xs,
    },
  }));

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
    } else {
      track("event_check_in_completed", { event_id: eventId, org_slug: orgSlug });
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
    return formatShortWeekdayDate(dateString);
  };

  const formatCheckInTime = (dateString: string) => {
    return formatTime(dateString);
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
            <Image source={item.user.avatar_url} style={styles.avatar} contentFit="cover" transition={200} recyclingKey={item.user.avatar_url} />
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
                <Check size={12} color={semantic.success} />
                <Text style={styles.checkedInTime}>
                  Checked in at {formatCheckInTime(item.checked_in_at)}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Pressable
          style={[styles.checkInButton, isCheckedIn && styles.undoButton]}
          onPress={() => (isCheckedIn ? handleUndoCheckIn(item) : handleCheckIn(item))}
        >
          {isCheckedIn ? (
            <X size={20} color={semantic.error} />
          ) : (
            <UserCheck size={20} color="#ffffff" />
          )}
        </Pressable>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Users size={40} color={neutral.muted} />
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
        <Pressable style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonTextLarge}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const loading = eventLoading || rsvpsLoading || roleLoading;
  const error = eventError || rsvpsError;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={semantic.success} />
        <Text style={styles.loadingText}>Loading check-in...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.backButtonLarge} onPress={() => router.back()}>
          <Text style={styles.backButtonTextLarge}>Go Back</Text>
        </Pressable>
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
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>

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
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
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
                <Calendar size={14} color={neutral.muted} />
                <Text style={styles.eventDetailText}>
                  {formatDate(event.start_date)} at {formatTime(event.start_date)}
                </Text>
              </View>
              {event.location && (
                <View style={styles.eventDetailRow}>
                  <MapPin size={14} color={neutral.muted} />
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
          <Search size={18} color={neutral.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor={neutral.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")}>
              <X size={18} color={neutral.muted} />
            </Pressable>
          )}
        </View>

        {/* Scan QR action */}
        {eventId && (
          <Pressable
            onPress={() => router.push(`/(app)/${orgSlug}/events/${eventId}/scan` as never)}
            style={({ pressed }) => [styles.scanButton, pressed && { opacity: 0.85 }]}
          >
            <QrCode size={18} color="#fff" />
            <Text style={styles.scanButtonText}>Scan QR to Check In</Text>
          </Pressable>
        )}

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
            <Pressable
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
            </Pressable>
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
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      </View>
    </View>
  );
}

