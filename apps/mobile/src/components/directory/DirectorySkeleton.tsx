import { View, StyleSheet } from "react-native";
import { spacing, borderRadius, type ThemeColors } from "@/lib/theme";

interface DirectorySkeletonProps {
  colors: ThemeColors;
}

export function DirectorySkeleton({ colors }: DirectorySkeletonProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.search, { backgroundColor: colors.card }]} />
      <View style={styles.filterRow}>
        {[80, 60, 70, 90].map((w, i) => (
          <View key={i} style={[styles.chip, { width: w, backgroundColor: colors.card }]} />
        ))}
      </View>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.avatar, { backgroundColor: colors.border }]} />
          <View style={styles.cardContent}>
            <View style={[styles.line, { width: "55%", backgroundColor: colors.border }]} />
            <View style={[styles.line, { width: "75%", marginTop: 6, backgroundColor: colors.border }]} />
            <View style={[styles.line, { width: "35%", marginTop: 5, backgroundColor: colors.border }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  search: {
    height: 48,
    borderRadius: borderRadius.xl,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  chip: {
    height: 32,
    borderRadius: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: spacing.md,
  },
  cardContent: {
    flex: 1,
  },
  line: {
    height: 12,
    borderRadius: 6,
  },
});
