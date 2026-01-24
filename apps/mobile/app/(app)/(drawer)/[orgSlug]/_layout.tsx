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
          headerShown: false,
          title: "Settings",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="settings/navigation"
        options={{
          title: "Navigation",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="events"
        options={{
          headerShown: false,
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
      {/* Folders with their own _layout.tsx - just register the folder name */}
      <Stack.Screen
        name="chat"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="workouts"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="competition"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="philanthropy"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="donations"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="expenses"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="schedules"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="forms"
        options={{
          headerShown: false,
        }}
      />
      {/* Standalone screens and folders without their own _layout.tsx */}
      <Stack.Screen
        name="competitions/new"
        options={{
          title: "Create Competition",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="alumni"
        options={{
          headerShown: false,
          title: "Alumni",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="mentorship"
        options={{
          headerShown: false,
          title: "Mentorship",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="records/index"
        options={{
          headerShown: false,
          title: "Records",
          presentation: "card",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return <OrgLayoutInner />;
}
