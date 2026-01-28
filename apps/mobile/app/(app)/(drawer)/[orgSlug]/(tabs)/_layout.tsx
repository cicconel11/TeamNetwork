import { useRef, useCallback } from "react";
import { Alert } from "react-native";
import { Tabs, useRouter } from "expo-router";
import Constants from "expo-constants";
import { OrgHeaderLeft } from "@/components/org-header-left";
import { TabBar } from "@/components/TabBar";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

// Determine if running in Expo Go
const isExpoGo = Constants.appOwnership === "expo";

// Conditionally import BottomSheet to avoid Reanimated issues in Expo Go
let BottomSheet: any = null;
let ActionSheet: any = null;

if (!isExpoGo) {
  try {
    BottomSheet = require("@gorhom/bottom-sheet").default;
    ActionSheet = require("@/components/ActionSheet").ActionSheet;
  } catch (e) {
    console.warn("BottomSheet not available:", e);
  }
}

export default function TabsLayout() {
  const { orgSlug } = useOrg();
  const router = useRouter();
  const bottomSheetRef = useRef<any>(null);
  const { isAdmin } = useOrgRole();

  const handleActionPress = useCallback(() => {
    if (isExpoGo || !BottomSheet) {
      // Show simple alert in Expo Go since BottomSheet requires native modules
      Alert.alert(
        "Quick Actions",
        "Action sheet is not available in Expo Go. Use a development build for full functionality.",
        [{ text: "OK" }]
      );
      return;
    }
    bottomSheetRef.current?.expand();
  }, []);

  const handleCloseSheet = useCallback(() => {
    bottomSheetRef.current?.close();
  }, []);

  // Action handlers (navigate to respective screens)
  const handleCreateEvent = useCallback(() => {
    if (!orgSlug) return;
    router.push(`/(app)/${orgSlug}/events/new`);
  }, [orgSlug, router]);

  const handlePostAnnouncement = useCallback(() => {
    if (!orgSlug) return;
    router.push(`/(app)/${orgSlug}/announcements/new`);
  }, [orgSlug, router]);

  const handleInviteMember = useCallback(() => {
    if (!orgSlug) return;
    router.push(`/(app)/${orgSlug}/members/new`);
  }, [orgSlug, router]);

  const handleRecordDonation = useCallback(() => {
    if (!orgSlug) return;
    router.push(`/(app)/${orgSlug}/donations/new`);
  }, [orgSlug, router]);

  const handleRsvpEvent = useCallback(() => {
    router.push(`/(app)/${orgSlug}/(tabs)/events`);
    handleCloseSheet();
  }, [orgSlug, router, handleCloseSheet]);

  const handleCheckIn = useCallback(() => {
    // TODO: Navigate to check-in screen
  }, []);

  const handleShareOrg = useCallback(() => {
    // TODO: Implement share org link
  }, []);

  const renderTabBar = useCallback(
    (props: any) => (
      <TabBar {...props} onActionPress={handleActionPress} />
    ),
    [handleActionPress]
  );

  return (
    <>
      <Tabs
        tabBar={renderTabBar}
        screenOptions={{
          headerShown: true,
          headerTitleAlign: "center",
          headerLeft: (props) => <OrgHeaderLeft {...props} />,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: "Events",
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="announcements"
          options={{
            title: "Announcements",
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="members"
          options={{
            title: "Members",
            headerShown: false,
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: "More",
            headerShown: false,
          }}
        />
        {/* Hide Alumni tab - not part of core loop */}
        <Tabs.Screen
          name="alumni"
          options={{
            href: null,
            headerShown: false,
          }}
        />
      </Tabs>

      {!isExpoGo && ActionSheet && (
        <ActionSheet
          ref={bottomSheetRef}
          isAdmin={isAdmin}
          onClose={handleCloseSheet}
          onCreateEvent={handleCreateEvent}
          onPostAnnouncement={handlePostAnnouncement}
          onInviteMember={handleInviteMember}
          onRecordDonation={handleRecordDonation}
          onRsvpEvent={handleRsvpEvent}
          onCheckIn={handleCheckIn}
          onShareOrg={handleShareOrg}
        />
      )}
    </>
  );
}
