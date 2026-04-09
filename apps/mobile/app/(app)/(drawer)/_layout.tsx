import React from "react";
import { Platform, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { useDrawerProgress } from "@react-navigation/drawer";
import Animated, { interpolate, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;
const DRAWER_SHIFT_RATIO = 0.15;
const SCALE_END = 0.88;
const RADIUS_END = 18;

export default function DrawerStackLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerProgress = useDrawerProgress();
  const reduceMotion = useReducedMotion();
  const styles = useThemedStyles((n) => ({
    scene: {
      flex: 1,
      backgroundColor: n.dark950,
      overflow: "hidden" as const,
      borderCurve: "continuous" as const,
    },
  }));

  const isWeb = Platform.OS === "web";

  const animatedStyle = useAnimatedStyle(() => {
    if (isWeb) return {};

    const progress = drawerProgress?.value ?? 0;
    const translateX = interpolate(progress, [0, 1], [0, drawerWidth * DRAWER_SHIFT_RATIO]);
    const scale = reduceMotion ? 1 : interpolate(progress, [0, 1], [1, SCALE_END]);
    const borderRadius = reduceMotion ? 0 : interpolate(progress, [0, 1], [0, RADIUS_END]);

    return {
      transform: [{ translateX }, { scale }],
      borderRadius,
    };
  }, [drawerWidth, reduceMotion, isWeb]);

  return (
    <Animated.View style={[styles.scene, animatedStyle]}>
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="[orgSlug]"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="terms"
          options={{
            title: "Terms of Service",
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            headerShown: false,
            title: "Edit Profile",
          }}
        />
      </Stack>
    </Animated.View>
  );
}
