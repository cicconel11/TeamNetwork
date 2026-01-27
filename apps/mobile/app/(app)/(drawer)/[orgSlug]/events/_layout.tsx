import { Stack } from "expo-router";

export default function EventsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="[eventId]/index"
        options={{
          headerShown: false,
          title: "Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="[eventId]/edit"
        options={{
          headerShown: false,
          title: "Edit Event",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="[eventId]/rsvps"
        options={{
          headerShown: false,
          title: "RSVPs",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="new"
        options={{
          headerShown: false,
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
