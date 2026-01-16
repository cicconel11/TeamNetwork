import { useRef, useCallback, useState, useEffect } from "react";
import { Alert } from "react-native";
import { Tabs, useLocalSearchParams, useRouter } from "expo-router";
import Constants from "expo-constants";
import { TabBar } from "@/components/TabBar";
import { supabase } from "@/lib/supabase";
import { normalizeRole, roleFlags } from "@teammeet/core";
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

export default function OrgLayout() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();
  const router = useRouter();
  const bottomSheetRef = useRef<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Fetch user role for this org
  useEffect(() => {
    let isMounted = true;

    async function fetchRole() {
      if (!orgSlug) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isMounted) return;

      // First get organization ID from slug
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) return;

      // Then get user role for that organization
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", org.id)
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
  }, [orgSlug]);

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
        }}
      >
        <Tabs.Screen
          name="(tabs)/index"
          options={{
            title: "Home",
          }}
        />
        <Tabs.Screen
          name="(tabs)/events"
          options={{
            title: "Events",
          }}
        />
        <Tabs.Screen
          name="(tabs)/members"
          options={{
            title: "Members",
          }}
        />
        <Tabs.Screen
          name="(tabs)/menu"
          options={{
            title: "Menu",
          }}
        />
        {/* Hide old tabs from navigation */}
        <Tabs.Screen
          name="(tabs)/alumni"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="(tabs)/announcements"
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
