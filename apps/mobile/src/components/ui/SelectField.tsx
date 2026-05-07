import React from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { ChevronDown } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import type { SelectOption } from "@/types/mentorship";

export function SelectField({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.selectField,
          pressed && styles.selectFieldPressed,
        ]}
      >
        <Text
          style={[
            styles.selectFieldText,
            !value && styles.selectFieldPlaceholder,
          ]}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={16} color={styles.chevronColor.color} />
      </Pressable>
    </View>
  );
}

export function SelectModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue: string | null;
  onSelect: (option: SelectOption) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          {options.length === 0 ? (
            <Text style={styles.modalEmptyText}>No options available.</Text>
          ) : (
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              renderItem={({ item }) => {
                const isSelected = item.value === selectedValue;
                return (
                  <Pressable
                    onPress={() => onSelect(item)}
                    style={({ pressed }) => [
                      styles.modalOption,
                      pressed && styles.modalOptionPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && styles.modalOptionSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={true}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    fieldGroup: {
      gap: SPACING.xs,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: n.secondary,
    },
    selectField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.background,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      fontSize: 16,
      color: n.foreground,
    },
    selectFieldPlaceholder: {
      color: n.muted,
    },
    // Workaround: StyleSheet.create doesn't support non-style values,
    // but we need the themed color for the icon prop.
    chevronColor: {
      color: n.placeholder,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: n.overlay,
      padding: SPACING.md,
    },
    modalSheet: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      maxHeight: "70%",
      gap: SPACING.sm,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    modalCloseText: {
      fontSize: 14,
      color: s.success,
      fontWeight: "600",
    },
    modalOption: {
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADIUS.md,
    },
    modalOptionPressed: {
      backgroundColor: n.divider,
    },
    modalOptionText: {
      fontSize: 16,
      color: n.foreground,
    },
    modalOptionSelected: {
      color: s.success,
    },
    modalDivider: {
      height: 1,
      backgroundColor: n.border,
    },
    modalEmptyText: {
      fontSize: 14,
      color: n.muted,
      paddingVertical: SPACING.sm,
      textAlign: "center",
    },
  });
