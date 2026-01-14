import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { supabase, debugAsyncStorage } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import LoadingScreen from "@/components/LoadingScreen";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Debug: Check AsyncStorage on app start
    if (__DEV__) {
      debugAsyncStorage();
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log("DEBUG: _layout getSession:", {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
        error,
      });
      if (!isMounted) return;
      setSession(session);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("DEBUG: _layout onAuthStateChange:", { event, hasSession: !!session });
      setSession(session);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [session, isLoading, segments, router]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Stack>
      <Stack.Screen
        name="(auth)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="(app)"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
