import { View, Text, Pressable, StyleSheet } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { spacing, fontSize, fontWeight, borderRadius, type ThemeColors } from "@/lib/theme";

interface DirectoryErrorStateProps {
  title: string;
  message?: string | null;
  colors: ThemeColors;
  onRetry: () => void;
}

export function DirectoryErrorState({ title, message, colors, onRetry }: DirectoryErrorStateProps) {
  return (
    <View style={styles.container}>
      <RefreshCw size={40} color={colors.border} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {message && <Text style={[styles.text, { color: colors.muted }]}>{message}</Text>}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary },
          pressed && styles.buttonPressed,
        ]}
        onPress={onRetry}
      >
        <RefreshCw size={16} color={colors.primaryForeground} />
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
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
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
