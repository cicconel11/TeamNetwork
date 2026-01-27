import { Stack } from "expo-router";

export default function WorkoutsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{ headerShown: false, title: "Post Workout" }}
      />
      <Stack.Screen
        name="[workoutId]"
        options={{ headerShown: false, title: "Edit Workout" }}
      />
    </Stack>
  );
}
