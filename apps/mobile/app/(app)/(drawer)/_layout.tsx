import React from "react";
import { StyleSheet, useWindowDimensions, View, Text } from "react-native";
import { Stack } from "expo-router";
import { useDrawerProgress } from "@react-navigation/drawer";
import Animated, { interpolate, useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { NEUTRAL } from "@/lib/design-tokens";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;
const DRAWER_SHIFT_RATIO = 0.15;
const SCALE_START = 1.0;
const SCALE_END = 0.88;
const RADIUS_END = 18;

export default function DrawerStackLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerProgress = useDrawerProgress();
  const reduceMotion = useReducedMotion();

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
            headerTitle: () => (
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "700" }}>
                  My Organizations
                </Text>
                <Text style={{ color: "rgba(255, 255, 255, 0.75)", fontSize: 12, marginTop: 2 }}>
                  Select an organization to continue
                </Text>
              </View>
            ),
            headerTitleAlign: "center",
            headerTintColor: "#ffffff",
            headerShadowVisible: false,
            headerStyle: {
              backgroundColor: "transparent",
            },
            headerBackground: () => (
              <LinearGradient
                colors={["#134e4a", "#0f172a"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1 }}
              />
            ),
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

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    backgroundColor: NEUTRAL.dark950,
    overflow: "hidden",
    borderCurve: "continuous",
  },
});
