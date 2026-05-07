import { Stack } from "expo-router";

export default function MentorshipLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[pairId]" />
    </Stack>
  );
}
