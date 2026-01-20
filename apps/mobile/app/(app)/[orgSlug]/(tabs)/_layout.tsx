import { useRef, useCallback, useState, useEffect } from "react";
import { Alert } from "react-native";
import { Tabs, useRouter } from "expo-router";
import Constants from "expo-constants";
import { TabBar } from "@/components/TabBar";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
import { useOrg } from "@/contexts/OrgContext";
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
  const { orgSlug, orgId } = useOrg();
  const router = useRouter();
  const bottomSheetRef = useRef<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Fetch user role for this org
  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgId) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isMounted) return;

      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

      if (roleData && isMounted) {
        const normalized = normalizeRole(roleData.role);
        const flags = roleFlags(normalized);
        setIsAdmin(flags.isAdmin);
      }
    }

    fetchRole();
    return () => { isMounted = false; };
  }, [orgId]);

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
    // TODO: Navigate to create event screen
    console.log("Create event");
  }, []);

  const handlePostAnnouncement = useCallback(() => {
    // TODO: Navigate to post announcement screen
    console.log("Post announcement");
  }, []);

  const handleInviteMember = useCallback(() => {
    // TODO: Navigate to invite member screen
    console.log("Invite member");
  }, []);

  const handleRecordDonation = useCallback(() => {
    // TODO: Navigate to record donation screen
    console.log("Record donation");
  }, []);

  const handleRsvpEvent = useCallback(() => {
    router.push(`/(app)/${orgSlug}/(tabs)/events`);
    handleCloseSheet();
  }, [orgSlug, router, handleCloseSheet]);

  const handleCheckIn = useCallback(() => {
    // TODO: Navigate to check-in screen
    console.log("Check in");
  }, []);

  const handleShareOrg = useCallback(() => {
    // TODO: Share org link
    console.log("Share org");
  }, []);

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <TabBar {...props} />
    ),
    []
  );

  return (
    <>
      <Tabs
        tabBar={renderTabBar}
        screenOptions={{
          headerShown: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: "Events",
          }}
        />
        <Tabs.Screen
          name="announcements"
          options={{
            title: "Announcements",
          }}
        />
        <Tabs.Screen
          name="members"
          options={{
            title: "Members",
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: "More",
          }}
        />
        {/* Hide Alumni tab - not part of core loop */}
        <Tabs.Screen
          name="alumni"
          options={{
            href: null,
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
