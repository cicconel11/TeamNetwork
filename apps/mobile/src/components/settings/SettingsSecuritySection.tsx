import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import { ChevronDown, Lock } from "lucide-react-native";
import {
  authenticate,
  getBiometricCapabilities,
  isBiometricEnabled,
  setBiometricEnabled,
} from "@/lib/biometric";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

/**
 * Biometric unlock toggle. Hidden entirely when the device has no biometric
 * hardware (matches plan R5.1).
 */
export function SettingsSecuritySection() {
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [caps, on] = await Promise.all([
        getBiometricCapabilities(),
        isBiometricEnabled(),
      ]);
      if (cancelled) return;
      setHasHardware(caps.hasHardware);
      setIsEnrolled(caps.isEnrolled);
      setEnabled(on);
      setResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const styles = useThemedStyles((n) => ({
    body: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 8,
    },
    rowLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: n.foreground,
    },
    hint: {
      fontSize: fontSize.sm,
      color: n.muted,
      marginTop: 4,
    },
  }));

  if (!resolved || !hasHardware) return null;

  const handleToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        if (!isEnrolled) {
          // Re-check in case the user enrolled since mount.
          const caps = await getBiometricCapabilities();
          setIsEnrolled(caps.isEnrolled);
          if (!caps.isEnrolled) return;
        }
        const result = await authenticate("Enable biometric unlock");
        if (!result.success) return;
        await setBiometricEnabled(true);
        setEnabled(true);
      } else {
        await setBiometricEnabled(false);
        setEnabled(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Lock size={20} color={colors.primary} />
          <Text style={baseStyles.sectionTitle}>Security</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.muted}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLabel}>Unlock with biometrics</Text>
              <Text style={styles.hint}>
                {isEnrolled
                  ? "Use Face ID, Touch ID, or your device passcode when you open or return to TeamMeet."
                  : "Set up Face ID, Touch ID, or a fingerprint in your device settings to enable this."}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              disabled={busy || !isEnrolled}
            />
          </View>
        </View>
      )}
    </View>
  );
}
