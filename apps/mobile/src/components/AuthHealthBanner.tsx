import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Application from "expo-application";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { pingAuthSurfaces } from "@/lib/auth-network";
import { captureMessage } from "@/lib/analytics";

type Status = "checking" | "ok" | "unreachable";

const RETRY_DELAY_MS = 3000;
const REPORT_THROTTLE_MS = 5 * 60 * 1000;

let lastReportedAt = 0;

export default function AuthHealthBanner() {
  const styles = useThemedStyles((_n, s) => ({
    wrap: {
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
    },
    banner: {
      backgroundColor: s.errorLight,
      borderColor: s.error,
      borderWidth: 1,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
    },
    bannerPressed: {
      opacity: 0.85,
    },
    title: {
      ...TYPOGRAPHY.labelLarge,
      color: s.errorDark,
      marginBottom: SPACING.xxs,
    },
    subtitle: {
      ...TYPOGRAPHY.bodySmall,
      color: s.errorDark,
    },
  }));

  const [status, setStatus] = useState<Status>("checking");
  const [dismissed, setDismissed] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const probe = useCallback(async () => {
    setStatus("checking");
    const first = await pingAuthSurfaces();
    if (!isMountedRef.current) return;
    if (first.supabase) {
      setStatus("ok");
      setDismissed(false);
      return;
    }

    await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
    if (!isMountedRef.current) return;

    const second = await pingAuthSurfaces();
    if (!isMountedRef.current) return;
    if (second.supabase) {
      setStatus("ok");
      setDismissed(false);
      return;
    }

    setStatus("unreachable");
    const now = Date.now();
    if (now - lastReportedAt > REPORT_THROTTLE_MS) {
      lastReportedAt = now;
      captureMessage("auth_surface_unreachable", "warning");
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  if (status !== "unreachable" || dismissed) {
    return null;
  }

  const version = Application.nativeApplicationVersion ?? "unknown";
  const build = Application.nativeBuildVersion ?? "unknown";

  return (
    <View
      style={styles.wrap}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Pressable
        onPress={probe}
        onLongPress={() => setDismissed(true)}
        accessibilityRole="button"
        accessibilityLabel="Sign-in service unreachable. Tap to retry."
        accessibilityHint="Long-press to dismiss"
        style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
      >
        <Text style={styles.title}>Sign-in service unreachable</Text>
        <Text style={styles.subtitle}>
          App {version} ({build}) — tap to retry. Long-press to dismiss.
        </Text>
      </Pressable>
    </View>
  );
}
