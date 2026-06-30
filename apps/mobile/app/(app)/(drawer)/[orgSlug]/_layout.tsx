import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import LoadingScreen from "@/components/LoadingScreen";
import { ErrorState } from "@/components/ui/ErrorState";
import { ColorSchemeProvider } from "@/contexts/ColorSchemeContext";
import { captureException } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { rememberLastActiveOrg, registerQuickActions } from "@/lib/quick-actions";
import { showToast } from "@/components/ui/Toast";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  captureException(error, { context: "OrgErrorBoundary" });
  // Surface the underlying error so we can diagnose on-device. Safe to keep —
  // ErrorState already renders nicely; the message just adds detail.
  console.error("[OrgErrorBoundary]", error);
  const message =
    (error as { message?: string } | null)?.message ?? String(error ?? "");

  return (
    <ColorSchemeProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
          <ErrorState
            onRetry={retry}
            title="Something went wrong"
            subtitle={message || "This screen encountered an error."}
          />
        </View>
      </SafeAreaView>
    </ColorSchemeProvider>
  );
}

function OrgLayoutInner() {
  const router = useRouter();
  const { session, isLoading: authLoading } = useAuth();
  const { orgSlug, status, isLoading } = useOrg();
  const { isAdmin } = useOrgRole();
  // Track which orgSlug we have already bounced from. Per-slug rather than
  // per-mount so navigating to a different org in the same mount can still
  // trigger a fresh bounce when warranted.
  const redirectedSlugRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't redirect on transient non-ready states caused by auth still
    // hydrating (cold launch from a notification tap) or by org data still
    // loading. The root layout owns the auth-group redirect.
    if (!orgSlug || authLoading || !session) return;
    if (isLoading || status === "loading" || status === "ready") return;
    if (redirectedSlugRef.current === orgSlug) return;

    // Only `not_found` and `unauthorized` should bounce to the org list.
    // `error` is rendered in place with a retry, so a flaky network doesn't
    // throw the user out of their deep link.
    if (status === "not_found" || status === "unauthorized") {
      redirectedSlugRef.current = orgSlug;
      showToast(
        status === "not_found"
          ? "That organization is no longer available."
          : "You no longer have access to this organization.",
        "warning",
      );
      router.replace("/(app)");
    }
  }, [orgSlug, authLoading, session, isLoading, status, router]);

  // Keep the home-screen Quick Actions in sync with the most recently visited
  // org + role so the action set matches what the user is most likely to do.
  useEffect(() => {
    if (!orgSlug || status !== "ready") return;
    void rememberLastActiveOrg({
      orgSlug,
      role: isAdmin ? "admin" : "member",
    }).then(() => registerQuickActions());
  }, [orgSlug, status, isAdmin]);

  if (!orgSlug || authLoading || isLoading || status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "error") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
          <ErrorState
            onRetry={() => router.replace(`/(app)/${orgSlug}` as any)}
            title="Couldn't load this organization"
            subtitle="Check your connection and try again."
          />
        </View>
      </SafeAreaView>
    );
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
        name="connections"
        options={{
          headerShown: false,
          title: "Connections",
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
        name="wallet/add-member-card"
        options={{
          headerShown: false,
          presentation: "modal",
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
          headerShown: false,
          title: "Search",
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
    </Stack>
  );
}

export default function OrgLayout() {
  return <OrgLayoutInner />;
}
