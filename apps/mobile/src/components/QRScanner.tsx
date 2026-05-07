import { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useDevicePermission } from "@/lib/device-permissions";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { TYPOGRAPHY } from "@/lib/typography";
import { SPACING, RADIUS } from "@/lib/design-tokens";

export interface QRScannerProps {
  /**
   * Called for every successful decode. Return `true` to keep scanning
   * (continuous mode); return `false`/void to stop until the parent unmounts
   * or re-mounts the component. The component re-arms after `cooldownMs` when
   * `true` is returned.
   */
  onScan: (value: string) => boolean | void | Promise<boolean | void>;
  /** ms to wait before accepting another scan in continuous mode. */
  cooldownMs?: number;
  /** Optional helper text rendered over the camera view. */
  hint?: string;
}

/**
 * Camera-based QR scanner. Handles the full permission lifecycle (undetermined
 * → granted/denied → settings deep-link) and re-arms scans without remounting
 * `CameraView` to avoid the camera-init flicker on each scan.
 */
export function QRScanner({ onScan, cooldownMs = 1500, hint }: QRScannerProps) {
  const { neutral, semantic } = useAppColorScheme();
  const { status, canAskAgain, request, openSettings, copy } =
    useDevicePermission("camera");

  const lockedRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const handleScanned = useCallback(
    async (result: BarcodeScanningResult) => {
      if (lockedRef.current) return;
      if (!result.data) return;
      lockedRef.current = true;
      setBusy(true);
      try {
        const keepScanning = await onScan(result.data);
        if (keepScanning === true) {
          setTimeout(() => {
            lockedRef.current = false;
            setBusy(false);
          }, cooldownMs);
        } else {
          setBusy(false);
        }
      } catch {
        setTimeout(() => {
          lockedRef.current = false;
          setBusy(false);
        }, cooldownMs);
      }
    },
    [onScan, cooldownMs]
  );

  if (status === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: neutral.background }]}>
        <ActivityIndicator color={semantic.success} />
      </View>
    );
  }

  if (status === "unsupported") {
    return (
      <View style={[styles.center, { backgroundColor: neutral.background }]}>
        <Text style={[styles.bodyText, { color: neutral.foreground }]}>
          Camera scanning isn&apos;t available on this device.
        </Text>
      </View>
    );
  }

  if (status !== "granted") {
    const denied = status === "denied" && !canAskAgain;
    return (
      <View
        style={[
          styles.center,
          { backgroundColor: neutral.background, padding: SPACING.lg },
        ]}
      >
        <Text style={[styles.title, { color: neutral.foreground }]}>{copy.title}</Text>
        <Text
          style={[styles.bodyText, { color: neutral.muted, marginTop: SPACING.sm }]}
        >
          {denied ? copy.deniedHint ?? copy.body : copy.body}
        </Text>
        <Pressable
          onPress={denied ? () => void openSettings() : () => void request()}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: semantic.success, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.ctaText}>
            {denied ? "Open Settings" : copy.primaryCta}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleScanned}
      />
      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.reticle} />
        {(hint || busy) && (
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>
              {busy ? "Processing…" : hint}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.85)",
    borderRadius: RADIUS.lg,
  },
  hintPill: {
    position: "absolute",
    bottom: 64,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  hintText: {
    ...TYPOGRAPHY.labelMedium,
    color: "#fff",
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    textAlign: "center",
  },
  bodyText: {
    ...TYPOGRAPHY.bodyMedium,
    textAlign: "center",
  },
  cta: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  ctaText: {
    ...TYPOGRAPHY.labelLarge,
    color: "#fff",
  },
});
