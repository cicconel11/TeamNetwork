import { Stack } from "expo-router";

export default function NotificationsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
          title: "Notifications",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="new"
        options={{
          headerShown: false,
          title: "Send Notification",
          presentation: "card",
        }}
      />
    </Stack>
  );
}
