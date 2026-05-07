import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Lock, Fingerprint } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING, RADIUS } from "@/lib/design-tokens";

interface LockScreenProps {
  onUnlock: () => Promise<{ success: boolean }>;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);

  const tryUnlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const { success } = await onUnlock();
    setBusy(false);
    if (!success) setFailures((n) => n + 1);
  }, [busy, onUnlock]);

  // Auto-prompt on mount.
  useEffect(() => {
    void tryUnlock();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // AuthContext will redirect on session change either way.
    }
  }, []);

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Lock size={28} color="#fff" />
        </View>
        <Text style={styles.title}>TeamMeet locked</Text>
        <Text style={styles.body}>
          {failures === 0
            ? "Use Face ID, Touch ID, or your device passcode to unlock."
            : "Authentication failed. Try again or sign out."}
        </Text>

        <Pressable
          onPress={tryUnlock}
          disabled={busy}
          style={({ pressed }) => [
            styles.cta,
            { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Fingerprint size={20} color="#fff" />
              <Text style={styles.ctaText}>Unlock</Text>
            </>
          )}
        </Pressable>

        {failures >= 2 && (
          <Pressable onPress={handleSignOut} style={styles.signOutLink} hitSlop={12}>
            <Text style={styles.signOutText}>Sign out instead</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
  },
  title: { ...TYPOGRAPHY.titleLarge, color: "#fff", textAlign: "center" },
  body: {
    ...TYPOGRAPHY.bodyMedium,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADIUS.md,
    backgroundColor: "#2563eb",
    minWidth: 200,
  },
  ctaText: { ...TYPOGRAPHY.labelLarge, color: "#fff" },
  signOutLink: { marginTop: SPACING.md },
  signOutText: {
    ...TYPOGRAPHY.labelMedium,
    color: "rgba(255,255,255,0.65)",
    textDecorationLine: "underline",
  },
});
