import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { signOut } from "@/lib/supabase";
import { useOrganizations } from "@/hooks/useOrganizations";
import type { Organization } from "@teammeet/types";

const colors = {
  background: "#ffffff",
  listBackground: "#f8fafc",
  title: "#0f172a",
  subtitle: "#64748b",
  chevron: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  avatarBg: "#eef2ff",
  avatarText: "#0f172a",
  pressed: "#f1f5f9",
  spinner: "#059669",
};

export default function OrganizationsScreen() {
  const router = useRouter();
  const { organizations, loading, error, refetch } = useOrganizations();
  const styles = useMemo(() => createStyles(), []);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.resolve(refetch()).finally(() => setRefreshing(false));
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const getOrgInitials = (org: Organization) => {
    const source = (org.name || org.slug || "").trim();
    if (!source) return "O";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  };

  const renderOrg = ({ item }: { item: Organization }) => {
    const initials = getOrgInitials(item);

    return (
      <Pressable
        onPress={() => router.push(`/(app)/${item.slug}`)}
        style={({ pressed }) => [styles.orgCard, pressed && styles.orgCardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}`}
      >
        <View style={styles.avatar}>
          {item.logo_url ? (
            <Image source={{ uri: item.logo_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View style={styles.orgInfo}>
          <Text style={styles.orgName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.orgSlug} numberOfLines={1}>
            @{item.slug}
          </Text>
        </View>

        <ChevronRight size={20} color={colors.chevron} />
      </Pressable>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.spinner} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={refetch} accessibilityRole="button">
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        data={organizations}
        keyExtractor={(item) => item.id}
        renderItem={renderOrg}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No organizations</Text>
            <Text style={styles.emptyText}>You are not a member of any organizations yet.</Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
              onPress={handleSignOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    listContent: {
      padding: 16,
      paddingTop: 20,
      backgroundColor: colors.listBackground,
    },

    orgCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    orgCardPressed: {
      backgroundColor: colors.pressed,
    },

    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.avatarBg,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      marginRight: 12,
    },
    avatarImage: {
      width: 44,
      height: 44,
      resizeMode: "cover",
    },
    avatarText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.avatarText,
    },

    orgInfo: {
      flex: 1,
      paddingRight: 8,
    },
    orgName: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.title,
    },
    orgSlug: {
      fontSize: 13,
      color: colors.subtitle,
      marginTop: 2,
    },

    errorTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.title,
      marginBottom: 8,
    },
    errorText: {
      fontSize: 14,
      color: colors.subtitle,
      textAlign: "center",
      marginBottom: 16,
    },
    retryButton: {
      backgroundColor: "#059669",
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 12,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },

    emptyContainer: {
      alignItems: "center",
      paddingVertical: 64,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.title,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 14,
      color: colors.subtitle,
      textAlign: "center",
      lineHeight: 20,
    },

    footer: {
      paddingTop: 12,
      paddingBottom: 32,
    },
    signOutButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      borderRadius: 16,
      alignItems: "center",
    },
    signOutButtonPressed: {
      backgroundColor: colors.pressed,
    },
    signOutText: {
      color: colors.subtitle,
      fontSize: 15,
      fontWeight: "600",
    },
  });
