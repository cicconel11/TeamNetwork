import { Stack } from "expo-router";
import { OrgProvider } from "@/contexts/OrgContext";

function OrgLayoutInner() {
  return (
    <Stack>
      <Stack.Screen
        name="(tabs)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: "Settings",
          presentation: "card",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return (
    <OrgProvider>
      <OrgLayoutInner />
    </OrgProvider>
  );
}
