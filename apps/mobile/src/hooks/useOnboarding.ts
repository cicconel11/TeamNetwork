import { useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const WELCOME_KEY = "onboarding_welcome_seen_v1";

export function useOnboarding() {
  const [hasSeenWelcome, setHasSeenWelcome] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  const loadWelcomeSeen = useCallback(async () => {
    try {
      const value = await AsyncStorage.getItem(WELCOME_KEY);
      setHasSeenWelcome(value === "true");
    } catch {
      setHasSeenWelcome(false);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const markWelcomeSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(WELCOME_KEY, "true");
      setHasSeenWelcome(true);
    } catch {
      // Still mark in state even if storage fails
      setHasSeenWelcome(true);
    }
  }, []);

  return { hasSeenWelcome, isLoaded, loadWelcomeSeen, markWelcomeSeen };
}
