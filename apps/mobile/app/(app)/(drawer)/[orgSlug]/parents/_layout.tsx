import { Stack } from "expo-router";

export default function ParentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" />
      <Stack.Screen name="[parentId]" />
      <Stack.Screen name="[parentId]/edit" />
    </Stack>
  );
}
