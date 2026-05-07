import { Stack } from "expo-router";

export default function FormsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[formId]"
        options={{ headerShown: true, title: "Form" }}
      />
      <Stack.Screen
        name="documents"
        options={{ headerShown: true, title: "Documents" }}
      />
    </Stack>
  );
}
