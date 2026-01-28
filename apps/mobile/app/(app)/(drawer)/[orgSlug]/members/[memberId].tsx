import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Pressable, Linking, Share } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Mail, Share as ShareIcon } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

interface Member {
  id: string;
  user_id: string;
  role: string;
  user?: {
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

export default function MemberProfileScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { orgSlug } = useOrg();
  const router = useRouter();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMember() {
      if (!memberId || !orgSlug) return;

      try {
        setLoading(true);
        const { data: orgData } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (!orgData) throw new Error("Organization not found");

        const { data, error: memberError } = await supabase
          .from("user_organization_roles")
          .select("id, user_id, role, user:users(name, email, avatar_url)")
          .eq("id", memberId)
          .eq("organization_id", orgData.id)
          .eq("status", "active")
          .single();

        if (memberError) throw memberError;
        setMember(data as Member);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchMember();
  }, [memberId, orgSlug]);

  const handleEmail = () => {
    if (member?.user?.email) {
      Linking.openURL(`mailto:${member.user.email}`);
    }
  };

  const handleShareEmail = async () => {
    if (member?.user?.email) {
      await Share.share({ message: member.user.email });
    }
  };

  const getInitials = () => {
    const name = member?.user?.name;
    if (name) {
      const parts = name.split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name[0]?.toUpperCase() || "?";
    }
    return member?.user?.email?.[0]?.toUpperCase() || "?";
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !member) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "Member not found"}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <ArrowLeft size={20} color={colors.primary} />
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <View style={styles.profileHeader}>
        {member.user?.avatar_url ? (
          <Image source={member.user.avatar_url} style={styles.avatarImage} contentFit="cover" transition={200} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
        )}
        <Text style={styles.name}>{member.user?.name || member.user?.email || "Unknown"}</Text>
        <Text style={styles.role}>{member.role === "admin" ? "Admin" : "Member"}</Text>
      </View>

      <View style={styles.contactSection}>
        <Text style={styles.sectionTitle}>Contact</Text>

        {member.user?.email && (
          <>
            <Pressable style={styles.contactButton} onPress={handleEmail}>
              <Mail size={20} color={colors.primary} />
              <View style={styles.contactInfo}>
                <Text style={styles.contactLabel}>Email</Text>
                <Text style={styles.contactValue} numberOfLines={1}>
                  {member.user.email}
                </Text>
              </View>
            </Pressable>

            <Pressable style={styles.contactButton} onPress={handleShareEmail}>
              <ShareIcon size={20} color={colors.primary} />
              <Text style={styles.contactButtonText}>Share email address</Text>
            </Pressable>
          </>
        )}

        {!member.user?.email && (
          <Text style={styles.noContactText}>No contact information available</Text>
        )}
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
      marginBottom: 24,
      gap: 8,
    },
    backButtonText: {
      fontSize: 16,
      color: colors.primary,
      fontWeight: "500",
    },
    profileHeader: {
      alignItems: "center",
      marginBottom: 32,
    },
    avatarImage: {
      width: 80,
      height: 80,
      borderRadius: 40,
      marginBottom: 16,
    },
    avatarPlaceholder: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primaryLight,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 16,
    },
    avatarText: {
      fontSize: 32,
      fontWeight: "600",
      color: colors.primaryDark,
    },
    name: {
      fontSize: 24,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 4,
    },
    role: {
      fontSize: 16,
      color: colors.muted,
    },
    contactSection: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
      marginBottom: 16,
    },
    contactButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    contactInfo: {
      flex: 1,
    },
    contactLabel: {
      fontSize: 14,
      color: colors.muted,
    },
    contactValue: {
      fontSize: 16,
      color: colors.foreground,
      marginTop: 2,
    },
    contactButtonText: {
      fontSize: 16,
      color: colors.primary,
      fontWeight: "500",
    },
    noContactText: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 16,
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: "center",
      marginBottom: 16,
    },
  });
