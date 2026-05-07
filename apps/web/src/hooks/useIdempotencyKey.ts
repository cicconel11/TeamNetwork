"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  storageKey: string;
  fingerprint: string | null;
};

function newKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function useIdempotencyKey({ storageKey, fingerprint }: Options) {
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const lastFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { key?: string; fingerprint?: string | null };
        if (parsed.key && (!parsed.fingerprint || parsed.fingerprint === fingerprint)) {
          setIdempotencyKey(parsed.key);
          lastFingerprint.current = parsed.fingerprint ?? null;
          return;
        }
      }
    } catch {
      // ignore malformed JSON; a fresh key will be written
    }

    const next = newKey();
    setIdempotencyKey(next);
    lastFingerprint.current = fingerprint ?? null;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ key: next, fingerprint }));
    } catch {
      // best effort
    }
  }, [fingerprint, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!idempotencyKey) return;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, fingerprint }));
    } catch {
      // ignore
    }
  }, [fingerprint, idempotencyKey, storageKey]);

  const refreshKey = useCallback(() => {
    const next = newKey();
    setIdempotencyKey(next);
    lastFingerprint.current = fingerprint ?? null;

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ key: next, fingerprint }));
      } catch {
        // ignore
      }
    }
  }, [fingerprint, storageKey]);

  useEffect(() => {
    if (fingerprint === lastFingerprint.current) return;
    if (!idempotencyKey) return;
    if (lastFingerprint.current && fingerprint && lastFingerprint.current !== fingerprint) {
      refreshKey();
    }
    lastFingerprint.current = fingerprint ?? null;
  }, [fingerprint, idempotencyKey, refreshKey]);

  return { idempotencyKey, refreshKey };
}
