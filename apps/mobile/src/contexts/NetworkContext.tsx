import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

interface NetworkContextValue {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  isOffline: boolean;
  registerReconnectCallback: (callback: () => void) => () => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { isConnected, isInternetReachable, isOffline, wasReconnected } = useNetworkStatus();
  const callbacksRef = useRef<Set<() => void>>(new Set());

  const registerReconnectCallback = useCallback((callback: () => void) => {
    callbacksRef.current.add(callback);
    return () => {
      callbacksRef.current.delete(callback);
    };
  }, []);

  // Fire all registered callbacks on reconnection
  useEffect(() => {
    if (wasReconnected) {
      callbacksRef.current.forEach((cb) => cb());
    }
  }, [wasReconnected]);

  const value = useMemo<NetworkContextValue>(() => ({
    isConnected,
    isInternetReachable,
    isOffline,
    registerReconnectCallback,
  }), [isConnected, isInternetReachable, isOffline, registerReconnectCallback]);

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return ctx;
}
