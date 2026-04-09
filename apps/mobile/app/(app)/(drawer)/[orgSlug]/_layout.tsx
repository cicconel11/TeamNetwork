import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import LoadingScreen from "@/components/LoadingScreen";
import { useOrg } from "@/contexts/OrgContext";

function OrgLayoutInner() {
  const router = useRouter();
  const { orgSlug, status, isLoading } = useOrg();

  useEffect(() => {
    if (!orgSlug || isLoading || status === "loading" || status === "ready") {
      return;
    }

    router.replace("/(app)");
  }, [orgSlug, isLoading, status, router]);

  if (!orgSlug || isLoading || status === "loading") {
    return <LoadingScreen />;
  }

  if (status !== "ready") {
    return <LoadingScreen />;
  }

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
          headerShown: false,
          title: "Settings",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="settings/navigation"
        options={{
          headerShown: false,
          title: "Navigation",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="events"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="announcements"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="members/[memberId]"
        options={{
          headerShown: false,
          title: "Member",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="members/new"
        options={{
          headerShown: false,
          title: "Invite Member",
          presentation: "card",
        }}
      />
      {/* Folders with their own _layout.tsx - just register the folder name */}
      <Stack.Screen
        name="chat"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="workouts"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="competition"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="philanthropy"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="donations"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="expenses"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="schedules"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="forms"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="feed"
        options={{
          headerShown: false,
        }}
      />
      {/* Standalone screens and folders without their own _layout.tsx */}
      <Stack.Screen
        name="competitions/new"
        options={{
          headerShown: false,
          title: "Create Competition",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="alumni"
        options={{
          headerShown: false,
          title: "Alumni",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="mentorship"
        options={{
          headerShown: false,
          title: "Mentorship",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="records/index"
        options={{
          headerShown: false,
          title: "Records",
          presentation: "card",
        }}
      />
      <Stack.Screen
        name="jobs"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="notifications"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="search"
        options={{
          headerShown: true,
          title: "Search",
          presentation: "card",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return <OrgLayoutInner />;
}
