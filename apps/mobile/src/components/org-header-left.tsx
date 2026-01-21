import { Pressable, View } from "react-native";
import { DrawerActions } from "@react-navigation/native";
import { useNavigation } from "expo-router";
import { HeaderBackButton, type HeaderBackButtonProps } from "@react-navigation/elements";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { OrgHeaderLogo } from "@/components/org-header-logo";

export function OrgHeaderLeft(props: HeaderBackButtonProps) {
  const navigation = useNavigation();
  const pressScale = useSharedValue(1);

  const handleLogoPress = () => {
    navigation.dispatch(DrawerActions.toggleDrawer());
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <View
      style={{
        marginLeft: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {props.canGoBack ? <HeaderBackButton {...props} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle menu"
        onPress={handleLogoPress}
        hitSlop={8}
        onPressIn={() => {
          pressScale.value = withTiming(0.94, { duration: 90 });
        }}
        onPressOut={() => {
          pressScale.value = withTiming(1, { duration: 120 });
        }}
      >
        <Animated.View style={animatedStyle}>
          <OrgHeaderLogo />
        </Animated.View>
      </Pressable>
    </View>
  );
}
