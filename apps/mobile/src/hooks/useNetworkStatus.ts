import { useEffect, useRef, useState } from "react";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

interface NetworkStatus {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  isOffline: boolean;
  wasReconnected: boolean;
}

const DEBOUNCE_MS = 500;

export function useNetworkStatus(): NetworkStatus {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isInternetReachable, setIsInternetReachable] = useState<boolean | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [wasReconnected, setWasReconnected] = useState(false);

  const prevHasNetworkAccessRef = useRef<boolean | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleStateChange = (state: NetInfoState) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const connected = state.isConnected ?? null;
        const reachable = state.isInternetReachable ?? null;
        const nextIsOffline = connected === false || reachable === false;
        const hasNetworkAccess =
          connected === true && reachable === true
            ? true
            : nextIsOffline
              ? false
              : null;

        if (prevHasNetworkAccessRef.current === false && hasNetworkAccess === true) {
          setWasReconnected(true);
        }

        prevHasNetworkAccessRef.current = hasNetworkAccess;
        setIsConnected(connected);
        setIsInternetReachable(reachable);
        setIsOffline(nextIsOffline);
      }, DEBOUNCE_MS);
    };

    const unsubscribe = NetInfo.addEventListener(handleStateChange);

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Reset wasReconnected after one render cycle
  useEffect(() => {
    if (wasReconnected) {
      const timer = setTimeout(() => setWasReconnected(false), 0);
      return () => clearTimeout(timer);
    }
  }, [wasReconnected]);

  return { isConnected, isInternetReachable, isOffline, wasReconnected };
}
