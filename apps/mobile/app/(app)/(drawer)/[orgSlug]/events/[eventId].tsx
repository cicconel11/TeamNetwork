import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Calendar, MapPin, Clock, Users, ArrowLeft } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import type { Event } from "@/hooks/useEvents";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvent() {
      if (!eventId || !orgSlug) return;

      try {
        setLoading(true);
        const { data: orgData } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (!orgData) throw new Error("Organization not found");

        const { data, error: eventError } = await supabase
          .from("events")
          .select("*")
          .eq("id", eventId)
          .eq("organization_id", orgData.id)
          .is("deleted_at", null)
          .single();

        if (eventError) throw eventError;
        setEvent(data as Event);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [eventId, orgSlug]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "Event not found"}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <ArrowLeft size={20} color={colors.primary} />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{event.title}</Text>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Calendar size={18} color={colors.muted} />
          <Text style={styles.detailText}>
            {formatDate(event.start_date)} at {formatTime(event.start_date)}
            {event.end_date && ` - ${formatTime(event.end_date)}`}
          </Text>
        </View>

        {event.location && (
          <View style={styles.detailRow}>
            <MapPin size={18} color={colors.muted} />
            <Text style={styles.detailText}>{event.location}</Text>
          </View>
        )}

        {event.rsvp_count !== undefined && (
          <View style={styles.detailRow}>
            <Users size={18} color={colors.muted} />
            <Text style={styles.detailText}>{event.rsvp_count} attending</Text>
          </View>
        )}
      </View>

      {event.description && (
        <View style={styles.description}>
          <Text style={styles.descriptionText}>{event.description}</Text>
        </View>
      )}

      {!event.user_rsvp_status && (
        <TouchableOpacity style={styles.rsvpButton}>
          <Text style={styles.rsvpButtonText}>RSVP</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 16,
      gap: 8,
    },
    backButtonText: {
      fontSize: 16,
      color: colors.primary,
      fontWeight: "500",
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 16,
    },
    details: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      gap: 12,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    detailText: {
      fontSize: 16,
      color: colors.foreground,
      flex: 1,
    },
    description: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
    },
    descriptionText: {
      fontSize: 16,
      color: colors.foreground,
      lineHeight: 24,
    },
    rsvpButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
    },
    rsvpButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: "600",
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: "center",
      marginBottom: 16,
    },
  });
