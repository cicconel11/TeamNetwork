import { Stack } from "expo-router";

export default function DonationsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{ headerShown: false, title: "Record Donation" }}
      />
    </Stack>
  );
}
