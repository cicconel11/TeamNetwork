import { Stack } from "expo-router";

export default function PhilanthropyLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{ headerShown: false, title: "New Philanthropy Event" }}
      />
    </Stack>
  );
}
