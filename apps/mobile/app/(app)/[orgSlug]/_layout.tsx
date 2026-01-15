import { Text } from "react-native";
import { Tabs, useLocalSearchParams } from "expo-router";

// Simple icon component using unicode symbols
function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>;
}

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
          tabBarIcon: ({ color }) => <TabIcon icon="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(tabs)/members"
        options={{
          title: "Members",
          tabBarLabel: "Members",
          tabBarIcon: ({ color }) => <TabIcon icon="👥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(tabs)/alumni"
        options={{
          title: "Alumni",
          tabBarLabel: "Alumni",
          tabBarIcon: ({ color }) => <TabIcon icon="🎓" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(tabs)/announcements"
        options={{
          title: "Announcements",
          tabBarLabel: "News",
          tabBarIcon: ({ color }) => <TabIcon icon="📢" color={color} />,
        }}
      />
    </Tabs>
  );
}
