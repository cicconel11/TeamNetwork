import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import LoadingScreen from "@/components/LoadingScreen";
import { ErrorState } from "@/components/ui/ErrorState";
import { captureException } from "@/lib/analytics";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { rememberLastActiveOrg, registerQuickActions } from "@/lib/quick-actions";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  captureException(error, { context: "OrgErrorBoundary" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <ErrorState
          onRetry={retry}
          title="Something went wrong"
          subtitle="This screen encountered an error."
        />
      </View>
    </SafeAreaView>
  );
}

function OrgLayoutInner() {
  const router = useRouter();
  const { orgSlug, status, isLoading } = useOrg();
  const { isAdmin } = useOrgRole();

  useEffect(() => {
    if (!orgSlug || isLoading || status === "loading" || status === "ready") {
      return;
    }

    router.replace("/(app)");
  }, [orgSlug, isLoading, status, router]);

  // Keep the home-screen Quick Actions in sync with the most recently visited
  // org + role so the action set matches what the user is most likely to do.
  useEffect(() => {
    if (!orgSlug || status !== "ready") return;
    void rememberLastActiveOrg({
      orgSlug,
      role: isAdmin ? "admin" : "member",
    }).then(() => registerQuickActions());
  }, [orgSlug, status, isAdmin]);

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
        name="settings/customization"
        options={{
          headerShown: false,
          title: "Customization",
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
      <Stack.Screen
        name="parents"
        options={{
          headerShown: false,
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
        name="mentorship/[pairId]"
        options={{
          headerShown: false,
          title: "Mentorship Pair",
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
