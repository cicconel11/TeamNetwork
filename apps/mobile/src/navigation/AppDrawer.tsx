import React from "react";
import { Platform, useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContent } from "@/navigation/DrawerContent";
import { useThemedStyles } from "@/hooks/useThemedStyles";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;

export function AppDrawer() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const styles = useThemedStyles((n) => ({
    drawer: {
      backgroundColor: n.dark950,
    },
    scene: {
      backgroundColor: n.dark950,
      overflow: "hidden" as const,
    },
  }));

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        // "front" = drawer slides over the scene (no squashed / narrowed main content).
        // "slide" shrinks the scene beside the drawer — avoid for a standard overlay drawer.
        drawerType: "front",
        overlayColor: "rgba(15, 23, 42, 0.52)",
        swipeEnabled: Platform.OS !== "web",
        swipeEdgeWidth: 48,
        drawerStyle: [
          styles.drawer,
          {
            width: drawerWidth,
          },
        ],
        sceneStyle: styles.scene,
      }}
      drawerContent={(props: any) => <DrawerContent {...props} />}
    >
      <Drawer.Screen
        name="(drawer)"
        options={{
          title: "Home",
        }}
      />
    </Drawer>
  );
}
