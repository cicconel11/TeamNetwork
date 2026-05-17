import React from "react";
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

function DirectorySearchBarBase({
  value,
  onChangeText,
  placeholder = "Search...",
  colors,
  rightSlot,
}: DirectorySearchBarProps) {
  return (
    <View style={styles.searchRow}>
      <View style={[styles.searchContainer, { backgroundColor: colors.mutedSurface }]}>
        <Search size={18} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
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

export const DirectorySearchBar = React.memo(DirectorySearchBarBase);

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.sm + 2,
    height: 40,
  },
  searchIcon: {
    marginRight: spacing.xs + 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    paddingVertical: 0,
  },
});
