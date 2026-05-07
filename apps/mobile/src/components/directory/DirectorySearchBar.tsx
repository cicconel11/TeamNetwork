import { View, TextInput, Pressable, StyleSheet } from "react-native";
import { Search, X } from "lucide-react-native";
import { spacing, fontSize, borderRadius, type ThemeColors } from "@/lib/theme";

interface DirectorySearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  colors: ThemeColors;
  rightSlot?: React.ReactNode;
}

export function DirectorySearchBar({
  value,
  onChangeText,
  placeholder = "Search...",
  colors,
  rightSlot,
}: DirectorySearchBarProps) {
  return (
    <View style={styles.searchRow}>
      <View style={[styles.searchContainer, { backgroundColor: colors.card }]}>
        <Search size={20} color={colors.muted} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {value.length > 0 && (
          <Pressable onPress={() => onChangeText("")} hitSlop={12}>
            <X size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {rightSlot}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.base,
    paddingVertical: 0,
  },
});
