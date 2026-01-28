import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { spacing, fontSize, fontWeight, type ThemeColors } from "@/lib/theme";

interface FilterGroup {
  label: string;
  options: unknown[];
  selected: unknown | null;
  onSelect: (value: unknown | null) => void;
  keyExtractor?: (item: unknown) => string;
  labelExtractor?: (item: unknown) => string;
}

interface DirectoryFilterChipsRowProps {
  groups: FilterGroup[];
  colors: ThemeColors;
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

function FilterChip({
  label,
  isActive,
  onPress,
  colors,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(0.95, { duration: 50 }),
      withTiming(1, { duration: 100 })
    );
    onPress();
  };

  return (
    <Pressable onPress={handlePress}>
      <Animated.View
        style={[
          styles.filterChip,
          { backgroundColor: colors.card, borderColor: colors.border },
          isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
          animatedStyle,
        ]}
      >
        <Text
          style={[
            styles.filterChipText,
            { color: colors.muted },
            isActive && { color: colors.primaryForeground },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function DirectoryFilterChipsRow({
  groups,
  colors,
  hasActiveFilters,
  onClearAll,
}: DirectoryFilterChipsRowProps) {
  if (groups.every((g) => g.options.length === 0)) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      {hasActiveFilters && (
        <Pressable onPress={onClearAll} style={styles.clearChip}>
          <X size={14} color={colors.error} />
          <Text style={[styles.clearChipText, { color: colors.error }]}>Clear</Text>
        </Pressable>
      )}

      {groups.map((group, groupIndex) => {
        if (group.options.length === 0) return null;
        const keyFn = group.keyExtractor || ((item: unknown) => String(item));
        const labelFn = group.labelExtractor || ((item: unknown) => String(item));

        return (
          <View key={group.label} style={styles.filterGroupWrapper}>
            {groupIndex > 0 && groups[groupIndex - 1].options.length > 0 && (
              <View style={[styles.filterDivider, { backgroundColor: colors.border }]} />
            )}
            <View style={styles.filterGroup}>
              <Text style={[styles.filterGroupLabel, { color: colors.mutedForeground }]}>
                {group.label}
              </Text>
              <View style={styles.filterGroupChips}>
                {group.options.slice(0, 5).map((option) => (
                  <FilterChip
                    key={keyFn(option)}
                    label={labelFn(option)}
                    isActive={group.selected !== null && keyFn(group.selected) === keyFn(option)}
                    onPress={() =>
                      group.onSelect(
                        group.selected !== null && keyFn(group.selected) === keyFn(option)
                          ? null
                          : option
                      )
                    }
                    colors={colors}
                  />
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    alignItems: "center",
  },
  filterGroupWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  filterGroupLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  filterGroupChips: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  filterDivider: {
    width: 1,
    height: 24,
    marginHorizontal: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  clearChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.2)",
  },
  clearChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
