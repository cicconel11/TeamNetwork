import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "My Organizations",
        }}
      />
      <Stack.Screen
        name="[orgSlug]"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="terms"
        options={{
          title: "Terms of Service",
        }}
      />
    </Stack>
  );
}
