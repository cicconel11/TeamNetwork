import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "@/lib/supabase";

const STORAGE_PREFIX = "create-org-checkout";

type Stored = { key: string; fingerprint: string | null };

function newKey(): string {
  return Crypto.randomUUID();
}

async function fingerprintHash(fingerprint: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    fingerprint
  );
  return digest.slice(0, 16);
}

/**
 * Mobile mirror of web's useIdempotencyKey, persisted via AsyncStorage and
 * scoped per-user + per-fingerprint. Stable across re-renders so retried
 * submits with the same form state hit the same payment_attempts row.
 */
export function useCreateOrgIdempotencyKey({
  fingerprint,
}: {
  fingerprint: string | null;
}) {
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const lastFingerprint = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fingerprint) return;
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id ?? "anon";
      const hash = await fingerprintHash(fingerprint);
      const key = `${STORAGE_PREFIX}:${userId}:${hash}`;
      if (cancelled) return;
      setStorageKey(key);

      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as Stored;
          if (
            parsed.key &&
            (!parsed.fingerprint || parsed.fingerprint === fingerprint)
          ) {
            if (cancelled) return;
            setIdempotencyKey(parsed.key);
            lastFingerprint.current = parsed.fingerprint ?? null;
            return;
          }
        }
      } catch {
        // fall through to fresh key
      }

      const next = newKey();
      if (cancelled) return;
      setIdempotencyKey(next);
      lastFingerprint.current = fingerprint;
      try {
        await AsyncStorage.setItem(
          key,
          JSON.stringify({ key: next, fingerprint } satisfies Stored)
        );
      } catch {
        // best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fingerprint]);

  const refreshKey = useCallback(async () => {
    if (!storageKey) return;
    const next = newKey();
    setIdempotencyKey(next);
    lastFingerprint.current = fingerprint;
    try {
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ key: next, fingerprint } satisfies Stored)
      );
    } catch {
      // best effort
    }
  }, [fingerprint, storageKey]);

  const clearKey = useCallback(async () => {
    if (!storageKey) return;
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {
      // best effort
    }
    setIdempotencyKey(null);
  }, [storageKey]);

  return { idempotencyKey, refreshKey, clearKey };
}
