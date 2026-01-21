/**
 * OverflowMenu component for admin actions.
 * Displays a "..." button that opens a menu with admin-only quick actions.
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Pressable,
} from "react-native";
import { MoreVertical } from "lucide-react-native";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { fontSize, fontWeight, borderRadius, spacing, type ThemeColors } from "@/lib/theme";

export interface OverflowMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  destructive?: boolean;
}

interface OverflowMenuProps {
  /** Menu items to display */
  items: OverflowMenuItem[];
  /** Icon size (default 20) */
  iconSize?: number;
  /** Icon color (defaults to theme muted color) */
  iconColor?: string;
  /** Accessibility label */
  accessibilityLabel?: string;
}

export function OverflowMenu({
  items,
  iconSize = 20,
  iconColor,
  accessibilityLabel = "More options",
}: OverflowMenuProps) {
  const [visible, setVisible] = useState(false);
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const resolvedIconColor = iconColor ?? colors.mutedForeground;

  const handleOpen = () => setVisible(true);
  const handleClose = () => setVisible(false);

  const handleItemPress = (item: OverflowMenuItem) => {
    handleClose();
    // Delay slightly to allow modal to close before action
    setTimeout(() => {
      item.onPress();
    }, 100);
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <TouchableOpacity
        onPress={handleOpen}
        style={styles.triggerButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        <MoreVertical size={iconSize} color={resolvedIconColor} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
      >
        <Pressable style={styles.overlay} onPress={handleClose}>
          <View style={styles.menuContainer}>
            <View style={styles.menu}>
              {items.map((item, index) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.menuItem,
                    index < items.length - 1 && styles.menuItemBorder,
                  ]}
                  onPress={() => handleItemPress(item)}
                  activeOpacity={0.7}
                >
                  {item.icon && <View style={styles.menuItemIcon}>{item.icon}</View>}
                  <Text
                    style={[
                      styles.menuItemText,
                      item.destructive && styles.menuItemTextDestructive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    triggerButton: {
      padding: 8,
    },
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      justifyContent: "flex-end",
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
    },
    menuContainer: {
      gap: spacing.sm,
    },
    menu: {
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      overflow: "hidden",
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 16,
      paddingHorizontal: 20,
    },
    menuItemBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    menuItemIcon: {
      marginRight: 12,
    },
    menuItemText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    menuItemTextDestructive: {
      color: colors.error,
    },
    cancelButton: {
      backgroundColor: colors.card,
      borderRadius: borderRadius.lg,
      paddingVertical: 16,
      alignItems: "center",
    },
    cancelButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.primary,
    },
  });

export default OverflowMenu;
