import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import type { Organization } from "@teammeet/types";

export default function DashboardScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const isMountedRef = useRef(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrganization = async () => {
    try {
      if (!orgSlug) {
        throw new Error("Organization not specified");
      }

      const { data, error: fetchError } = await supabase
        .from("organizations")
        .select("*")
        .eq("slug", orgSlug)
        .single();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setOrganization(data);
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
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchOrganization();

    return () => {
      isMountedRef.current = false;
    };
  }, [orgSlug]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOrganization();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.orgName}>{organization?.name}</Text>
        <Text style={styles.orgSlug}>@{organization?.slug}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Welcome!</Text>
        <Text style={styles.cardText}>
          Use the tabs below to view members, alumni, and announcements.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: "#dc2626",
    textAlign: "center",
  },
  header: {
    marginBottom: 24,
  },
  orgName: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a1a1a",
  },
  orgSlug: {
    fontSize: 16,
    color: "#666",
    marginTop: 4,
  },
  card: {
    backgroundColor: "white",
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});
