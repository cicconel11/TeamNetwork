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
        name="settings/navigation"
        options={{
          title: "Navigation",
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
        name="chat"
        options={{
          title: "Chat",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="chat/[groupId]"
        options={{
          title: "Chat",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="workouts"
        options={{
          title: "Workouts",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="workouts/new"
        options={{
          title: "Post Workout",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="workouts/[workoutId]/edit"
        options={{
          title: "Edit Workout",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="competition"
        options={{
          title: "Competition",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="competition/add-team"
        options={{
          title: "Add Team",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="competition/add-points"
        options={{
          title: "Add Points",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="competitions/new"
        options={{
          title: "Create Competition",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="philanthropy"
        options={{
          title: "Philanthropy",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="philanthropy/new"
        options={{
          title: "New Philanthropy Event",
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
