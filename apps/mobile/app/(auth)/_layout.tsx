import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useOnboarding } from "@/hooks/useOnboarding";

export default function AuthLayout() {
  const router = useRouter();
  const segments = Array.from(useSegments());
  const { loadWelcomeSeen } = useOnboarding();
  const currentScreen = segments.at(-1) ?? "index";

  useEffect(() => {
    let cancelled = false;

    const syncWelcomeRoute = async () => {
      if (currentScreen !== "index" && currentScreen !== "welcome") {
        return;
      }

      const hasSeenWelcome = await loadWelcomeSeen();
      if (cancelled) return;

      if (currentScreen === "index" && !hasSeenWelcome) {
        router.replace("/(auth)/welcome");
        return;
      }

      if (currentScreen === "welcome" && hasSeenWelcome) {
        router.replace("/(auth)");
      }
    };

    void syncWelcomeRoute();

    return () => {
      cancelled = true;
    };
  }, [currentScreen, loadWelcomeSeen, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="callback" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
