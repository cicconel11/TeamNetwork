import { useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const WELCOME_KEY = "onboarding_welcome_seen_v1";

export async function readWelcomeSeen(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(WELCOME_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

export function useOnboarding() {
  const [hasSeenWelcome, setHasSeenWelcome] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  const loadWelcomeSeen = useCallback(async () => {
    const seen = await readWelcomeSeen();
    setHasSeenWelcome(seen);
    setIsLoaded(true);
    return seen;
  }, []);

  const markWelcomeSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(WELCOME_KEY, "true");
      setHasSeenWelcome(true);
      setIsLoaded(true);
    } catch {
      // Still mark in state even if storage fails
      setHasSeenWelcome(true);
      setIsLoaded(true);
    }
  }, []);

  return { hasSeenWelcome, isLoaded, loadWelcomeSeen, markWelcomeSeen };
}
