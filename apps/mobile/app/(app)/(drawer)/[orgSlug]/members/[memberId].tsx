import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Linking,
  Image,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { DrawerActions } from "@react-navigation/native";
import { Mail, Share as ShareIcon, Linkedin } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { APP_CHROME } from "@/lib/chrome";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

interface Member {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  graduation_year: number | null;
  role: string | null;
  linkedin_url: string | null;
}

export default function MemberProfileScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { orgId, orgSlug, orgName, orgLogoUrl } = useOrg();
  const router = useRouter();
  const navigation = useNavigation();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {}
  }, [navigation]);

  useEffect(() => {
    async function fetchMember() {
      if (!memberId || !orgId) return;

      try {
        setLoading(true);

        const { data, error: memberError } = await supabase
          .from("members")
          .select("id, first_name, last_name, email, photo_url, graduation_year, role, linkedin_url")
          .eq("id", memberId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
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
  }, [memberId, orgId]);

  const handleEmail = () => {
    if (member?.email) {
      Linking.openURL(`mailto:${member.email}`);
    }
  };

  const handleShareEmail = async () => {
    if (member?.email) {
      await Share.share({ message: member.email });
    }
  };

  const handleLinkedIn = () => {
    if (member?.linkedin_url) {
      Linking.openURL(member.linkedin_url);
    }
  };

  const getInitials = () => {
    if (member?.first_name && member?.last_name) {
      return (member.first_name[0] + member.last_name[0]).toUpperCase();
    }
    if (member?.first_name) {
      return member.first_name[0].toUpperCase();
    }
    return member?.email?.[0]?.toUpperCase() || "?";
  };

  const getDisplayName = () => {
    if (member?.first_name && member?.last_name) {
      return `${member.first_name} ${member.last_name}`;
    }
    return member?.first_name || member?.email || "Unknown";
  };

  const getRoleLabel = () => {
    if (member?.role === "admin") return "Admin";
    return "Member";
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Member</Text>
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

  if (error || !member) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.headerTitle}>Member</Text>
              <View style={styles.headerSpacer} />
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error || "Member not found"}</Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButtonAlt, pressed && styles.backButtonAltPressed]}
            >
              <Text style={styles.backButtonAltText}>Go Back</Text>
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
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={{ uri: orgLogoUrl }} style={styles.orgLogo} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0] || "O"}</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.headerTitle}>Member</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Profile Header */}
          <View style={styles.profileHeader}>
            {member.photo_url ? (
              <Image source={{ uri: member.photo_url }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{getInitials()}</Text>
              </View>
            )}
            <Text style={styles.name}>{getDisplayName()}</Text>
            <View style={styles.badges}>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{getRoleLabel()}</Text>
              </View>
              {member.graduation_year && (
                <View style={styles.yearBadge}>
                  <Text style={styles.yearBadgeText}>Class of {member.graduation_year}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Contact Section */}
          <View style={styles.contactSection}>
            <Text style={styles.sectionTitle}>Contact</Text>

            {member.email && (
              <>
                <Pressable
                  onPress={handleEmail}
                  style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
                >
                  <Mail size={20} color={SEMANTIC.success} />
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactLabel}>Email</Text>
                    <Text style={styles.contactValue} numberOfLines={1}>
                      {member.email}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={handleShareEmail}
                  style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
                >
                  <ShareIcon size={20} color={SEMANTIC.success} />
                  <Text style={styles.contactButtonText}>Share email address</Text>
                </Pressable>
              </>
            )}

            {member.linkedin_url && (
              <Pressable
                onPress={handleLinkedIn}
                style={({ pressed }) => [styles.contactButton, pressed && styles.contactButtonPressed]}
              >
                <Linkedin size={20} color={SEMANTIC.success} />
                <Text style={styles.contactButtonText}>View LinkedIn profile</Text>
              </Pressable>
            )}

            {!member.email && !member.linkedin_url && (
              <Text style={styles.noContactText}>No contact information available</Text>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NEUTRAL.background,
  },
  headerGradient: {
    // Gradient fills this area
  },
  headerSafeArea: {
    // SafeAreaView handles top inset
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  orgLogoButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  orgLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  orgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  orgAvatarText: {
    ...TYPOGRAPHY.titleMedium,
    color: APP_CHROME.headerTitle,
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
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: SPACING.md,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: SEMANTIC.successLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.md,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: "600",
    color: SEMANTIC.successDark,
  },
  name: {
    ...TYPOGRAPHY.headlineMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.sm,
    textAlign: "center",
  },
  badges: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  roleBadge: {
    backgroundColor: SEMANTIC.successLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
  },
  roleBadgeText: {
    ...TYPOGRAPHY.labelSmall,
    color: SEMANTIC.successDark,
  },
  yearBadge: {
    backgroundColor: NEUTRAL.background,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  yearBadgeText: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.secondary,
  },
  contactSection: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleMedium,
    color: NEUTRAL.foreground,
    marginBottom: SPACING.md,
  },
  contactButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: NEUTRAL.border,
  },
  contactButtonPressed: {
    opacity: 0.7,
  },
  contactInfo: {
    flex: 1,
  },
  contactLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: NEUTRAL.muted,
  },
  contactValue: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.foreground,
    marginTop: 2,
  },
  contactButtonText: {
    ...TYPOGRAPHY.bodyMedium,
    color: SEMANTIC.success,
    fontWeight: "500",
  },
  noContactText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
    textAlign: "center",
    paddingVertical: SPACING.md,
  },
  errorText: {
    ...TYPOGRAPHY.bodyMedium,
    color: SEMANTIC.error,
    textAlign: "center",
    marginBottom: SPACING.md,
  },
  backButtonAlt: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: SEMANTIC.success,
  },
  backButtonAltPressed: {
    opacity: 0.9,
  },
  backButtonAltText: {
    ...TYPOGRAPHY.labelMedium,
    color: "#ffffff",
  },
});
