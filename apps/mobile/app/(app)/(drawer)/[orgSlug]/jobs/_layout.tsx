import { Stack } from "expo-router";

export default function JobsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{
          presentation: "formSheet",
          sheetGrabberVisible: true,
        }}
      />
      <Stack.Screen name="[jobId]/index" />
      <Stack.Screen
        name="[jobId]/edit"
        options={{
          presentation: "formSheet",
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  );
}
