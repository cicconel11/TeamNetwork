import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function AlumniScreen() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();

  return (
    <View style={styles.container}>
      <View style={styles.placeholder}>
        <Text style={styles.title}>Alumni Directory</Text>
        <Text style={styles.subtitle}>Coming soon</Text>
        <Text style={styles.description}>
          View and connect with alumni from {orgSlug}.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  placeholder: {
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#2563eb",
    fontWeight: "500",
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
});
