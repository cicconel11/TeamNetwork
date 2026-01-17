import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

import { useRouter, useFocusEffect } from "expo-router";
import {
  Users,
  Calendar,
  Heart,
  ChevronRight,
  Pin,
  Clock,
  MapPin,
} from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useEvents } from "@/hooks/useEvents";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { useMembers } from "@/hooks/useMembers";
import { useOrg } from "@/contexts/OrgContext";
import { normalizeRole, roleFlags } from "@teammeet/core";
import type { Organization } from "@teammeet/types";

export default function HomeScreen() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { user } = useAuth();
  const isMountedRef = useRef(true);

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const isRefetchingRef = useRef(false);

  const { events, refetch: refetchEvents, refetchIfStale: refetchEventsIfStale } = useEvents(orgSlug || "");
  const { announcements, refetch: refetchAnnouncements, refetchIfStale: refetchAnnouncementsIfStale } = useAnnouncements(orgSlug || "");
  const { members, refetch: refetchMembers, refetchIfStale: refetchMembersIfStale } = useMembers(orgSlug || "");
  const userId = user?.id ?? null;

  // Get upcoming events (next 2)
  const now = new Date();
  const upcomingEvents = events
    .filter((e) => new Date(e.start_date) >= now)
    .slice(0, 2);

  // Get pinned announcement
  const pinnedAnnouncement = announcements.find((a) => (a as any).is_pinned);

  const fetchData = useCallback(async () => {
    if (!orgSlug || !user) {
      return;
    }

    try {
      // Fetch organization
      const { data: orgData, error: fetchError } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", orgSlug)
        .single();

      if (fetchError) throw fetchError;

      // Fetch user profile and role
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role, user:users(name)")
        .eq("user_id", user.id)
        .eq("organization_id", orgData.id)
        .eq("status", "active")
        .single();

      if (isMountedRef.current) {
        setOrganization(orgData);
        setOrgId(orgData.id);

        if (roleData) {
          const normalized = normalizeRole(roleData.role);
          const flags = roleFlags(normalized);
          setIsAdmin(flags.isAdmin);

          const userData = roleData.user as { name: string | null } | null;
          setUserName(userData?.name || null);
        }
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [orgSlug, user]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  useEffect(() => {
    setOrgId(null);
  }, [orgSlug]);

  useEffect(() => {
    setMemberCount(members.length);
  }, [members]);

  // Refetch on tab focus if data is stale
  useFocusEffect(
    useCallback(() => {
      refetchEventsIfStale();
      refetchAnnouncementsIfStale();
      refetchMembersIfStale();
    }, [refetchEventsIfStale, refetchAnnouncementsIfStale, refetchMembersIfStale])
  );

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`organization:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${orgId}`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchData]);

  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase
      .channel(`organization-role:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)
            ?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)
            ?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            fetchData();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchData]);

  const handleRefresh = async () => {
    if (isRefetchingRef.current) return;
    setRefreshing(true);
    isRefetchingRef.current = true;
    try {
      await Promise.all([
        fetchData(),
        refetchEvents(),
        refetchAnnouncements(),
        refetchMembers(),
      ]);
    } finally {
      setRefreshing(false);
      isRefetchingRef.current = false;
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const formatDate = () => {
    return new Date().toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const formatEventTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const firstName = userName?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563eb" />
        }
      >
        {/* Welcome Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {getGreeting()}, {firstName}
          </Text>
          <Text style={styles.orgName}>{organization?.name}</Text>
          <Text style={styles.date}>{formatDate()}</Text>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Users size={20} color="#2563eb" />
            <Text style={styles.statValue}>{memberCount}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </View>
          <View style={styles.statItem}>
            <Calendar size={20} color="#2563eb" />
            <Text style={styles.statValue}>{upcomingEvents.length}</Text>
            <Text style={styles.statLabel}>Events</Text>
          </View>
          <View style={styles.statItem}>
            <Heart size={20} color="#2563eb" />
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Donations</Text>
          </View>
        </View>

        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Events</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => router.push(`/(app)/${orgSlug}/(tabs)/events`)}
            >
              <Text style={styles.seeAllText}>See all</Text>
              <ChevronRight size={16} color="#2563eb" />
            </TouchableOpacity>
          </View>

          {upcomingEvents.length > 0 ? (
            upcomingEvents.map((event) => (
              <TouchableOpacity key={event.id} style={styles.eventCard} activeOpacity={0.7}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.title}
                </Text>
                <View style={styles.eventDetails}>
                  <View style={styles.eventDetail}>
                    <Clock size={14} color="#666" />
                    <Text style={styles.eventDetailText}>
                      {formatEventTime(event.start_date)}
                    </Text>
                  </View>
                  {event.location && (
                    <View style={styles.eventDetail}>
                      <MapPin size={14} color="#666" />
                      <Text style={styles.eventDetailText} numberOfLines={1}>
                        {event.location}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity style={styles.rsvpButton}>
                  <Text style={styles.rsvpButtonText}>RSVP</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Calendar size={24} color="#9ca3af" />
              <Text style={styles.emptyText}>No upcoming events</Text>
            </View>
          )}
        </View>

        {/* Pinned Announcement */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Pinned</Text>
          </View>

          {pinnedAnnouncement ? (
            <TouchableOpacity style={styles.announcementCard} activeOpacity={0.7}>
              <View style={styles.pinnedBadge}>
                <Pin size={12} color="#2563eb" />
                <Text style={styles.pinnedText}>Pinned</Text>
              </View>
              <Text style={styles.announcementTitle} numberOfLines={1}>
                {pinnedAnnouncement.title}
              </Text>
              <Text style={styles.announcementPreview} numberOfLines={3}>
                {pinnedAnnouncement.body}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyCard}>
              <Pin size={24} color="#9ca3af" />
              <Text style={styles.emptyText}>No pinned announcements</Text>
            </View>
          )}
        </View>

        {/* Latest Activity */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Latest</Text>
          </View>

          <View style={styles.activityCard}>
            <Text style={styles.activityEmpty}>
              Activity feed coming soon
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  header: {
    marginBottom: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  orgName: {
    fontSize: 15,
    color: "#666",
    marginTop: 4,
  },
  date: {
    fontSize: 13,
    color: "#9ca3af",
    marginTop: 2,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    marginBottom: 24,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  seeAllButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  seeAllText: {
    fontSize: 14,
    color: "#2563eb",
    fontWeight: "500",
  },
  eventCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  eventDetails: {
    gap: 4,
  },
  eventDetail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eventDetailText: {
    fontSize: 13,
    color: "#666",
    flex: 1,
  },
  rsvpButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 12,
  },
  rsvpButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  announcementCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  pinnedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  pinnedText: {
    fontSize: 12,
    color: "#2563eb",
    fontWeight: "500",
  },
  announcementTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  announcementPreview: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 24,
    alignItems: "center",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  emptyText: {
    fontSize: 14,
    color: "#9ca3af",
    marginTop: 8,
  },
  activityCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 24,
    alignItems: "center",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  activityEmpty: {
    fontSize: 14,
    color: "#9ca3af",
  },
  errorText: {
    fontSize: 16,
    color: "#dc2626",
    textAlign: "center",
  },
});
