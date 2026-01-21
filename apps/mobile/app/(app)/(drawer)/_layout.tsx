import React, { useMemo } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { useDrawerProgress } from "@react-navigation/drawer";
import Animated, { interpolate, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;
const DRAWER_SHIFT_RATIO = 0.6;
const SCALE_END = 0.92;
const RADIUS_END = 18;

export default function DrawerStackLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerProgress = useDrawerProgress();
  const reduceMotion = useReducedMotion();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const animatedStyle = useAnimatedStyle(() => {
    const progress = drawerProgress?.value ?? 0;
    const translateX = interpolate(progress, [0, 1], [0, drawerWidth * DRAWER_SHIFT_RATIO]);
    const scale = reduceMotion ? 1 : interpolate(progress, [0, 1], [1, SCALE_END]);
    const borderRadius = reduceMotion ? 0 : interpolate(progress, [0, 1], [0, RADIUS_END]);

    return {
      transform: [{ translateX }, { scale }],
      borderRadius,
    };
  }, [drawerWidth, reduceMotion]);

  return (
    <Animated.View style={[styles.scene, animatedStyle]}>
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: "My Organizations",
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
      </Stack>
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    scene: {
      flex: 1,
      backgroundColor: colors.background,
      overflow: "hidden",
      borderCurve: "continuous",
    },
  });
