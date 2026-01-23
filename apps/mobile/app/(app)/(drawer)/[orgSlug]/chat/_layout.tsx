import { Stack } from "expo-router";

export default function ChatLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[groupId]"
        options={{ headerShown: true, title: "Chat" }}
      />
    </Stack>
  );
}
