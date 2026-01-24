import { Stack } from "expo-router";

export default function EventsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="[eventId]/index"
        options={{
          title: "Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="[eventId]/edit"
        options={{
          title: "Edit Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="[eventId]/rsvps"
        options={{
          title: "RSVPs",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="new"
        options={{
          title: "Create Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="check-in"
        options={{
          headerShown: false,
          title: "Check In",
          presentation: "card",
        }}
      />
    </Stack>
  );
}
