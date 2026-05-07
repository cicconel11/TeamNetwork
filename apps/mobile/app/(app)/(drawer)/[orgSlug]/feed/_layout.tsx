import { Stack } from "expo-router";

export default function FeedLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="new" />
      <Stack.Screen name="[postId]" />
    </Stack>
  );
}
