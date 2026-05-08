import React from "react";
import { View, Text, TextInput, Pressable, Switch } from "react-native";
import { Plus, X } from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
const MAX_OPTION_LENGTH = 200;

interface PollBuilderProps {
  readonly options: readonly string[];
  readonly onOptionsChange: (opts: string[]) => void;
  readonly allowChange: boolean;
  readonly onAllowChangeToggle: (v: boolean) => void;
}

export const PollBuilder = React.memo(function PollBuilder({
  options,
  onOptionsChange,
  allowChange,
  onAllowChangeToggle,
}: PollBuilderProps) {
  const { neutral, semantic } = useAppColorScheme();
  const styles = useThemedStyles((n) => ({
    container: {
      marginTop: SPACING.md,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.lg,
      backgroundColor: n.background,
      padding: SPACING.sm,
      gap: SPACING.xs,
    },
    optionRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      backgroundColor: n.surface,
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingLeft: SPACING.sm,
      paddingRight: SPACING.xs,
    },
    optionIndex: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
      width: 14,
    },
    optionInput: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      flex: 1,
      paddingVertical: SPACING.sm,
    },
    removeButton: {
      width: 28,
      height: 28,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderRadius: RADIUS.sm,
    },
    addButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      alignSelf: "flex-start" as const,
    },
    addButtonText: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    allowChangeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingTop: SPACING.xs,
      paddingHorizontal: SPACING.xs,
    },
    allowChangeLabel: {
      ...TYPOGRAPHY.bodySmall,
      color: n.secondary,
      flex: 1,
      marginRight: SPACING.sm,
    },
  }));

  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    onOptionsChange(next);
  };

  const removeOption = (index: number) => {
    if (options.length <= MIN_OPTIONS) return;
    onOptionsChange(options.filter((_, i) => i !== index));
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    onOptionsChange([...options, ""]);
  };

  return (
    <View style={styles.container}>
      {options.map((opt, i) => (
        <View key={i} style={styles.optionRow}>
          <Text style={styles.optionIndex}>{i + 1}</Text>
          <TextInput
            style={styles.optionInput}
            value={opt}
            onChangeText={(t) => updateOption(i, t)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={neutral.placeholder}
            maxLength={MAX_OPTION_LENGTH}
            accessibilityLabel={`Poll option ${i + 1}`}
          />
          {options.length > MIN_OPTIONS && (
            <Pressable
              onPress={() => removeOption(i)}
              style={styles.removeButton}
              accessibilityLabel={`Remove option ${i + 1}`}
              accessibilityRole="button"
              hitSlop={6}
            >
              <X size={16} color={semantic.error} />
            </Pressable>
          )}
        </View>
      ))}

      {options.length < MAX_OPTIONS && (
        <Pressable
          onPress={addOption}
          style={styles.addButton}
          accessibilityLabel="Add poll option"
          accessibilityRole="button"
        >
          <Plus size={16} color={neutral.foreground} />
          <Text style={styles.addButtonText}>Add option</Text>
        </Pressable>
      )}

      <View style={styles.allowChangeRow}>
        <Text style={styles.allowChangeLabel}>
          Allow voters to change their answer
        </Text>
        <Switch value={allowChange} onValueChange={onAllowChangeToggle} />
      </View>
    </View>
  );
});
