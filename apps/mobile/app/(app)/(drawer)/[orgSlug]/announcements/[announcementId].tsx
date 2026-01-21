import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Pin } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import type { Announcement } from "@teammeet/types";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

export default function AnnouncementDetailScreen() {
  const { announcementId } = useLocalSearchParams<{ announcementId: string }>();
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAnnouncement() {
      if (!announcementId || !orgSlug) return;

      try {
        setLoading(true);
        const { data: orgData } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (!orgData) throw new Error("Organization not found");

        const { data, error: announcementError } = await supabase
          .from("announcements")
          .select("*")
          .eq("id", announcementId)
          .eq("organization_id", orgData.id)
          .is("deleted_at", null)
          .single();

        if (announcementError) throw announcementError;
        setAnnouncement(data as Announcement);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchAnnouncement();
  }, [announcementId, orgSlug]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !announcement) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "Announcement not found"}</Text>
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

      {announcement.is_pinned && (
        <View style={styles.pinnedBadge}>
          <Pin size={14} color={colors.primaryDark} />
          <Text style={styles.pinnedText}>PINNED</Text>
        </View>
      )}

      <Text style={styles.title}>{announcement.title}</Text>
      <Text style={styles.date}>{formatDate(announcement.created_at)}</Text>

      <View style={styles.body}>
        <Text style={styles.bodyText}>{announcement.body}</Text>
      </View>
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
    pinnedBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      alignSelf: "flex-start",
      marginBottom: 12,
      gap: 6,
    },
    pinnedText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.primaryDark,
      textTransform: "uppercase",
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 8,
    },
    date: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginBottom: 24,
    },
    body: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
    },
    bodyText: {
      fontSize: 16,
      color: colors.foreground,
      lineHeight: 24,
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: "center",
      marginBottom: 16,
    },
  });
