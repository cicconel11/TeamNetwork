import { Tabs, useLocalSearchParams } from "expo-router";

export default function OrgLayout() {
  const { orgSlug } = useLocalSearchParams<{ orgSlug: string }>();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#94a3b8",
        headerShown: true,
      }}
    >
      <Tabs.Screen
        name="(tabs)/index"
        options={{
          title: "Dashboard",
          tabBarLabel: "Home",
        }}
      />
      <Tabs.Screen
        name="(tabs)/members"
        options={{
          title: "Members",
          tabBarLabel: "Members",
        }}
      />
      <Tabs.Screen
        name="(tabs)/alumni"
        options={{
          title: "Alumni",
          tabBarLabel: "Alumni",
        }}
      />
      <Tabs.Screen
        name="(tabs)/announcements"
        options={{
          title: "Announcements",
          tabBarLabel: "News",
        }}
      />
    </Tabs>
  );
}
