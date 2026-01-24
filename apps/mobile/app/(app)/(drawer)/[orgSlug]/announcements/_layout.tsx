import { Stack } from "expo-router";

export default function AnnouncementsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="new" />
      <Stack.Screen name="[announcementId]" />
    </Stack>
  );
}
