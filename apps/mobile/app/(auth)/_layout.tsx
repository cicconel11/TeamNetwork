import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { useOnboarding } from "@/hooks/useOnboarding";

export default function AuthLayout() {
  const router = useRouter();
  const { hasSeenWelcome, isLoaded, loadWelcomeSeen } = useOnboarding();

  useEffect(() => {
    loadWelcomeSeen();
  }, [loadWelcomeSeen]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!hasSeenWelcome) {
      router.replace("/(auth)/welcome");
    }
  }, [isLoaded, hasSeenWelcome, router]);

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
