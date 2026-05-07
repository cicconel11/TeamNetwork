import { useCallback, useRef } from "react";

export function useRequestTracker() {
  const versionRef = useRef(0);

  const beginRequest = useCallback(() => {
    const requestId = versionRef.current + 1;
    versionRef.current = requestId;
    return requestId;
  }, []);

  const invalidateRequests = useCallback(() => {
    versionRef.current += 1;
  }, []);

  const isCurrentRequest = useCallback((requestId: number) => {
    return requestId === versionRef.current;
  }, []);

  return {
    beginRequest,
    invalidateRequests,
    isCurrentRequest,
  };
}
