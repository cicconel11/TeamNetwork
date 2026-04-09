import { useEffect } from "react";
import { useNetwork } from "@/contexts/NetworkContext";

export function useAutoRefetchOnReconnect(refetchFn: () => void): void {
  const { registerReconnectCallback } = useNetwork();

  useEffect(() => {
    return registerReconnectCallback(refetchFn);
  }, [refetchFn, registerReconnectCallback]);
}
