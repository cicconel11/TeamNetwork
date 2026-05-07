import { Pressable, View } from "react-native";
import { DrawerActions } from "@react-navigation/native";
import { useNavigation } from "expo-router";
import { HeaderBackButton, type HeaderBackButtonProps } from "@react-navigation/elements";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Menu } from "lucide-react-native";
import { OrgHeaderLogo } from "@/components/org-header-logo";

export function OrgHeaderLeft(props: HeaderBackButtonProps) {
  const navigation = useNavigation();
  const logoScale = useSharedValue(1);
  const menuScale = useSharedValue(1);

  const handleToggleDrawer = () => {
    navigation.dispatch(DrawerActions.toggleDrawer());
  };

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  const menuAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: menuScale.value }],
  }));

  return (
    <View
      style={{
        marginLeft: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      {navigation.canGoBack() && <HeaderBackButton {...props} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        onPress={handleToggleDrawer}
        hitSlop={8}
        onPressIn={() => {
          menuScale.value = withTiming(0.9, { duration: 90 });
        }}
        onPressOut={() => {
          menuScale.value = withTiming(1, { duration: 120 });
        }}
      >
        <Animated.View style={menuAnimatedStyle}>
          <Menu size={22} color="#1f2937" strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle menu"
        onPress={handleToggleDrawer}
        hitSlop={8}
        onPressIn={() => {
          logoScale.value = withTiming(0.94, { duration: 90 });
        }}
        onPressOut={() => {
          logoScale.value = withTiming(1, { duration: 120 });
        }}
      >
        <Animated.View style={logoAnimatedStyle}>
          <OrgHeaderLogo />
        </Animated.View>
      </Pressable>
    </View>
  );
}
