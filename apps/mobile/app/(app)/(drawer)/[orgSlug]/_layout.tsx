import { Stack } from "expo-router";
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
        name="events/new"
        options={{
          title: "Create Event",
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
        name="announcements/new"
        options={{
          title: "Post Announcement",
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
      <Stack.Screen
        name="members/new"
        options={{
          title: "Invite Member",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="donations/new"
        options={{
          title: "Record Donation",
          presentation: "card",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return <OrgLayoutInner />;
}
