import { Stack } from "expo-router";

export default function SchedulesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{ headerShown: false, title: "New Schedule" }}
      />
      <Stack.Screen
        name="[scheduleId]"
        options={{ headerShown: true, title: "Schedule" }}
      />
    </Stack>
  );
}
