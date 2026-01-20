import { Stack } from "expo-router";
import { OrgProvider } from "@/contexts/OrgContext";

function OrgLayoutInner() {
  return (
    <Stack>
      <Stack.Screen
        name="(tabs)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: "Settings",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="events/[eventId]"
        options={{
          title: "Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="announcements/[announcementId]"
        options={{
          title: "Announcement",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="members/[memberId]"
        options={{
          title: "Member",
          presentation: "card",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return (
    <OrgProvider>
      <OrgLayoutInner />
    </OrgProvider>
  );
}
