import { View, Text, StyleSheet } from "react-native";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import AlumniScreen from "./(tabs)/alumni";

export default function AlumniDrawerRoute() {
  const { permissions, isLoading } = useOrgRole();
  const { colors } = useOrgTheme();

  if (isLoading) {
    return null;
  }

  if (!permissions.canViewAlumni) {
    return (
      <View style={styles.noAccess}>
        <Text style={[styles.noAccessText, { color: colors.muted }]}>
          You do not have access to the alumni directory.
        </Text>
      </View>
    );
  }

  return <AlumniScreen />;
}

const styles = StyleSheet.create({
  noAccess: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  noAccessText: {
    fontSize: 16,
    textAlign: "center",
  },
});
