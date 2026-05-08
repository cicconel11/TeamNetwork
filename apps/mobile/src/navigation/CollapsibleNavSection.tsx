import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChevronDown } from "lucide-react-native";
import { NEUTRAL } from "@/lib/design-tokens";
import { spacing, fontWeight } from "@/lib/theme";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface CollapsibleNavSectionProps {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  containsActive?: boolean;
  children: React.ReactNode;
}

export function CollapsibleNavSection({
  label,
  isOpen,
  onToggle,
  containsActive = false,
  children,
}: CollapsibleNavSectionProps) {
  const rotation = useSharedValue(isOpen ? 0 : -90);

  React.useEffect(() => {
    rotation.value = withTiming(isOpen ? 0 : -90, { duration: 180 });
  }, [isOpen, rotation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handlePress = () => {
    LayoutAnimation.configureNext({
      duration: 200,
      create: { type: "easeInEaseOut", property: "opacity" },
      update: { type: "easeInEaseOut" },
      delete: { type: "easeInEaseOut", property: "opacity" },
    });
    onToggle();
  };

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={handlePress}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <Text
          style={[
            styles.label,
            containsActive && !isOpen && styles.labelActive,
          ]}
        >
          {label}
        </Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={16} color={NEUTRAL.placeholder} strokeWidth={2} />
        </Animated.View>
      </Pressable>
      {isOpen ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 40,
    paddingHorizontal: spacing.sm,
  },
  headerPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    color: NEUTRAL.placeholder,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  labelActive: {
    color: NEUTRAL.surface,
  },
  body: {
    gap: 0,
  },
});
