import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { ExternalLink, LogOut } from "lucide-react-native";
import { useRouter } from "expo-router";
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";

const colors = {
  background: "#ffffff",
  pressed: "#f1f5f9",
  divider: "#e2e8f0",
  label: "#94a3b8",
  text: "#64748b",
  destructive: "#dc2626",
  icon: "#94a3b8",
};

export function OrgSwitcherActions() {
  const router = useRouter();

  const handleJoin = () => {
    Linking.openURL(`${getWebAppUrl()}/app/join`);
  };

  const handleCreate = () => {
    Linking.openURL(`${getWebAppUrl()}/app/create-org`);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Account actions</Text>

      <Pressable
        onPress={handleJoin}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="link"
        accessibilityLabel="Join another organization (opens web)"
      >
        <Text style={styles.rowText}>Join another organization</Text>
        <ExternalLink size={16} color={colors.icon} />
      </Pressable>

      <Pressable
        onPress={handleCreate}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="link"
        accessibilityLabel="Create a new organization (opens web)"
      >
        <Text style={styles.rowText}>Create a new organization</Text>
        <ExternalLink size={16} color={colors.icon} />
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        onPress={handleSignOut}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={[styles.rowText, styles.destructiveText]}>Sign out</Text>
        <LogOut size={16} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.label,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowPressed: {
    backgroundColor: colors.pressed,
  },
  rowText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
  },
  destructiveText: {
    color: colors.destructive,
  },
});
