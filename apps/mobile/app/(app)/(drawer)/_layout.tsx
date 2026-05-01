import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { useThemedStyles } from "@/hooks/useThemedStyles";

/**
 * Stack inside the drawer. Keep the scene static — do not scale or translate
 * with drawer progress (that pattern squeezes content). The drawer itself is
 * configured as `drawerType: "front"` in AppDrawer so it overlays the app.
 */
export default function DrawerStackLayout() {
  const styles = useThemedStyles((n) => ({
    scene: {
      flex: 1,
      backgroundColor: n.dark950,
      overflow: "hidden" as const,
      borderCurve: "continuous" as const,
    },
  }));

  return (
    <View style={styles.scene}>
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
          name="create-org"
          options={{
            headerShown: false,
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            headerShown: false,
            title: "Edit Profile",
          }}
        />
        <Stack.Screen
          name="delete-account"
          options={{
            headerShown: false,
            title: "Delete Account",
          }}
        />
      </Stack>
    </View>
  );
}
