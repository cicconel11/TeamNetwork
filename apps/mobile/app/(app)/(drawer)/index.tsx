import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { signOut } from "@/lib/supabase";
import { useOrganizations } from "@/hooks/useOrganizations";
import type { Organization } from "@teammeet/types";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

export default function OrganizationsScreen() {
  const router = useRouter();
  const { organizations, loading, error, refetch } = useOrganizations();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.resolve(refetch()).finally(() => setRefreshing(false));
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const renderOrg = ({ item }: { item: Organization }) => (
    <TouchableOpacity
      style={styles.orgCard}
      onPress={() => router.push(`/(app)/${item.slug}`)}
      activeOpacity={0.7}
    >
      <View style={styles.orgInfo}>
        <Text style={styles.orgName}>{item.name}</Text>
        <Text style={styles.orgSlug}>@{item.slug}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={refetch}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No organizations</Text>
            <Text style={styles.emptyText}>
              You are not a member of any organizations yet.
            </Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
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
      paddingBottom: 80,
    },
    orgCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    orgInfo: {
      flex: 1,
    },
    orgName: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
    },
    orgSlug: {
      fontSize: 14,
      color: colors.muted,
      marginTop: 4,
    },
    chevron: {
      fontSize: 24,
      color: colors.mutedForeground,
      marginLeft: 8,
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: "center",
      marginBottom: 16,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    retryButtonText: {
      color: colors.primaryForeground,
      fontSize: 14,
      fontWeight: "600",
    },
    emptyContainer: {
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
      marginBottom: 8,
    },
    emptyText: {
      fontSize: 14,
      color: colors.muted,
      textAlign: "center",
    },
    signOutButton: {
      position: "absolute",
      bottom: 24,
      left: 16,
      right: 16,
      backgroundColor: colors.border,
      padding: 16,
      borderRadius: 12,
      alignItems: "center",
    },
    signOutText: {
      color: colors.muted,
      fontSize: 16,
      fontWeight: "500",
    },
  });
