import { Stack } from "expo-router";

export default function ChatLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[groupId]" />
      <Stack.Screen name="threads/index" />
      <Stack.Screen name="threads/[threadId]" />
      <Stack.Screen name="threads/new" />
    </Stack>
  );
}
