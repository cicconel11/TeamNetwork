import { View, Text, Pressable, StyleSheet } from "react-native";
import { X } from "lucide-react-native";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";

interface DirectoryEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  colors: ThemeColors;
  showClearButton?: boolean;
  onClear?: () => void;
}

export function DirectoryEmptyState({
  icon,
  title,
  subtitle,
  colors,
  showClearButton,
  onClear,
}: DirectoryEmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon}
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.text, { color: colors.muted }]}>{subtitle}</Text>
      {showClearButton && onClear && (
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && styles.buttonPressed,
          ]}
          onPress={onClear}
        >
          <X size={16} color={colors.primary} />
          <Text style={[styles.buttonText, { color: colors.primary }]}>Clear all filters</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  text: {
    fontSize: fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
