import { useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useGlobalSearchParams } from "expo-router";
import { useOrganizations } from "@/hooks/useOrganizations";
import { OrganizationRow } from "@/components/org-switcher/OrganizationRow";
import { OrgSwitcherActions } from "@/components/org-switcher/OrgSwitcherActions";
import type { Organization } from "@teammeet/types";

const colors = {
  background: "#ffffff",
  title: "#0f172a",
  subtitle: "#64748b",
  spinner: "#059669",
};

export default function OrganizationsScreen() {
  const router = useRouter();
  const params = useGlobalSearchParams<{ orgSlug?: string }>();
  const currentSlug = params.orgSlug;
  const { organizations, loading, error, refetch } = useOrganizations();
  const styles = useMemo(() => createStyles(), []);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.resolve(refetch()).finally(() => setRefreshing(false));
  };

  const handleOrgPress = (org: Organization) => {
    router.replace(`/(app)/${org.slug}/(tabs)` as const);
  };

  const renderOrg = ({ item }: { item: Organization }) => {
    const isCurrent = currentSlug ? item.slug === currentSlug : undefined;
    return (
      <OrganizationRow
        org={item}
        isCurrent={isCurrent}
        onPress={() => handleOrgPress(item)}
      />
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
        ListFooterComponent={<OrgSwitcherActions />}
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
      paddingTop: 8,
      backgroundColor: colors.background,
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
  });
