import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Wallet } from "lucide-react-native";
import { addToWallet, type AddToWalletResult } from "@/lib/add-to-wallet";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";

type Props = {
  /** Path under /api/wallet/, e.g. `/api/wallet/event/<uuid>` */
  apiPath: string;
  /** Filename to write to the cache directory (without extension). */
  fileBaseName: string;
  /** Optional override label; defaults to "Add to Apple Wallet". */
  label?: string;
  /** Called after a download attempt; receives the AddToWalletResult. */
  onResult?: (result: AddToWalletResult) => void;
};

/**
 * Apple-styled call-to-action that downloads a `.pkpass` from the platform
 * API and hands it to Wallet via `Linking.openURL`. iOS-only — renders
 * nothing on other platforms.
 */
export function AddToWalletButton({ apiPath, fileBaseName, label, onResult }: Props) {
  const { neutral } = useAppColorScheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles = useThemedStyles((n, s) => ({
    button: {
      backgroundColor: "#000000",
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.md,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
    },
    buttonPressed: { opacity: 0.85 },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { ...TYPOGRAPHY.labelLarge, color: "#ffffff" },
    error: { ...TYPOGRAPHY.bodySmall, color: s.error, marginTop: SPACING.xs },
  }));

  const onPress = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await addToWallet({ apiPath, fileBaseName });
    setBusy(false);
    if (result.status === "added") {
      onResult?.(result);
      return;
    }
    if (result.status === "unsupported_platform") {
      setError("Apple Wallet is iOS only.");
    } else if (result.status === "unauthenticated") {
      setError("Sign in required.");
    } else {
      setError(result.message);
    }
    onResult?.(result);
  }, [apiPath, fileBaseName, onResult]);

  if (Platform.OS !== "ios") return null;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? "Add to Apple Wallet"}
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          busy && styles.buttonDisabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <>
            <Wallet size={18} color={neutral.surface} />
            <Text style={styles.buttonText}>{label ?? "Add to Apple Wallet"}</Text>
          </>
        )}
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
