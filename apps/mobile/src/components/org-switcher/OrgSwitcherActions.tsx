import { View, Text, Pressable, StyleSheet } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ExternalLink, LogOut } from "lucide-react-native";
import { useRouter } from "expo-router";
import { signOut } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";
import { NEUTRAL, SEMANTIC, SHADOWS, RADIUS, SPACING } from "@/lib/design-tokens";

export function OrgSwitcherActions() {
  const router = useRouter();

  const openInApp = (path: string) => {
    void WebBrowser.openBrowserAsync(`${getWebAppUrl()}${path}`, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: NEUTRAL.foreground,
      dismissButtonStyle: "close",
    });
  };

  const handleJoin = () => openInApp("/app/join");
  const handleCreate = () => router.push("/(app)/(drawer)/create-org" as never);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)");
  };

  return (
    <>
      {/* Account Actions card group */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account Actions</Text>
        <View style={styles.cardGroup}>
          <Pressable
            onPress={handleJoin}
            style={({ pressed }) => [
              styles.row,
              styles.rowFirst,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="link"
            accessibilityLabel="Join another organization (opens web)"
          >
            <Text style={styles.rowText}>Join another organization</Text>
            <ExternalLink size={16} color={NEUTRAL.muted} />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            onPress={handleCreate}
            style={({ pressed }) => [
              styles.row,
              styles.rowLast,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create a new organization"
          >
            <Text style={styles.rowText}>Create a new organization</Text>
          </Pressable>
        </View>
      </View>

      {/* Sign out card group */}
      <View style={styles.section}>
        <View style={styles.cardGroup}>
          <Pressable
            onPress={handleSignOut}
            style={({ pressed }) => [
              styles.row,
              styles.rowFirst,
              styles.rowLast,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={[styles.rowText, styles.destructiveText]}>Sign out</Text>
            <LogOut size={16} color={SEMANTIC.error} />
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: SPACING.lg,
    marginHorizontal: SPACING.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: NEUTRAL.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  cardGroup: {
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.xl,
    overflow: "hidden",
    ...SHADOWS.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: NEUTRAL.border,
    marginLeft: SPACING.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: NEUTRAL.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  rowFirst: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  rowLast: {
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
  },
  rowPressed: {
    backgroundColor: NEUTRAL.divider,
  },
  rowText: {
    fontSize: 15,
    fontWeight: "500",
    color: NEUTRAL.secondary,
  },
  destructiveText: {
    color: SEMANTIC.error,
    fontWeight: "600",
  },
});
