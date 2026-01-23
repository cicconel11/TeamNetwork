import { Stack } from "expo-router";

export default function CompetitionLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="add-team"
        options={{ headerShown: true, title: "Add Team" }}
      />
      <Stack.Screen
        name="add-points"
        options={{ headerShown: true, title: "Add Points" }}
      />
    </Stack>
  );
}
