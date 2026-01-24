import React, { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContent } from "@/navigation/DrawerContent";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

const DRAWER_WIDTH_RATIO = 0.78;
const DRAWER_MAX_WIDTH = 320;

export function AppDrawer() {
  const { width } = useWindowDimensions();
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        drawerType: "slide",
        overlayColor: "rgba(0, 0, 0, 0.35)",
        swipeEnabled: true,
        swipeEdgeWidth: 40,
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

const createStyles = (colors: ThemeColors) => ({
  drawer: {
    backgroundColor: colors.card,
  },
  scene: {
    backgroundColor: colors.background,
  },
});
