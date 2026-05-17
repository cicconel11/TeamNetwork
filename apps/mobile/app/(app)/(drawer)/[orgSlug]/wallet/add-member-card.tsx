import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useOrg } from "@/contexts/OrgContext";
import { addToWallet } from "@/lib/add-to-wallet";
import { APP_CHROME } from "@/lib/chrome";
import { RADIUS, SPACING } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

type Stage = "idle" | "downloading" | "presenting" | "error";

/**
 * Fetches the member's `.pkpass` from the web API, writes it to the app cache,
 * and hands it off to the OS — iOS routes the file URL to the Wallet app.
 * Android falls back to a friendly "iOS only" message.
 */
export default function AddMemberCardScreen() {
  const router = useRouter();
  const { orgSlug, orgName } = useOrg();
  const { neutral, semantic } = useAppColorScheme();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const styles = useThemedStyles((n, s) => ({
    container: { flex: 1, backgroundColor: n.background },
    headerContent: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      minHeight: 44,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleLarge,
      color: APP_CHROME.headerTitle,
      flex: 1,
      textAlign: "center" as const,
    },
    headerSpacer: { width: 36 },
    sheet: {
      flex: 1,
      backgroundColor: n.surface,
      padding: SPACING.lg,
      gap: SPACING.lg,
    },
    title: { ...TYPOGRAPHY.headlineSmall, color: n.foreground },
    body: { ...TYPOGRAPHY.bodyMedium, color: n.secondary },
    button: {
      backgroundColor: s.success,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.md,
      alignItems: "center" as const,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: SPACING.sm,
    },
    buttonText: { ...TYPOGRAPHY.labelLarge, color: "#ffffff" },
    buttonDisabled: { opacity: 0.6 },
    errorCard: {
      backgroundColor: s.errorLight,
      borderColor: s.error,
      borderWidth: 1,
      padding: SPACING.md,
      borderRadius: RADIUS.md,
    },
    errorText: { ...TYPOGRAPHY.bodySmall, color: s.error },
  }));

  const handleBack = useCallback(() => {
    if ((router as any).canGoBack?.()) router.back();
    else router.replace(`/(app)/${orgSlug}` as any);
  }, [router, orgSlug]);

  const handleAdd = useCallback(async () => {
    setError(null);
    setStage("downloading");
    const result = await addToWallet({
      apiPath: `/api/wallet/member/${orgSlug}`,
      fileBaseName: `${orgSlug}-member-card`,
    });
    if (result.status === "added") {
      setStage("idle");
      return;
    }
    if (result.status === "unsupported_platform") {
      setError("Apple Wallet is iOS only. Use Google Wallet on Android (coming soon).");
    } else if (result.status === "unauthenticated") {
      setError("Sign in required.");
    } else {
      setError(result.message);
    }
    setStage("error");
  }, [orgSlug]);

  useEffect(() => {
    setError(null);
  }, [orgSlug]);

  const isBusy = stage === "downloading" || stage === "presenting";

  return (
    <View style={styles.container}>
      <LinearGradient colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}>
        <SafeAreaView edges={["top"]}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton} hitSlop={8}>
              <ChevronLeft size={28} color={APP_CHROME.headerTitle} />
            </Pressable>
            <Text style={styles.headerTitle}>Add to Apple Wallet</Text>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.sheet}>
        <Text style={styles.title}>{orgName} Member Card</Text>
        <Text style={styles.body}>
          Save your member card to Apple Wallet for quick access at check-in.
          The pass shows your name, role, and a QR code that admins can scan to
          verify your membership.
        </Text>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleAdd}
          disabled={isBusy}
          style={({ pressed }) => [
            styles.button,
            (pressed || isBusy) && styles.buttonDisabled,
          ]}
        >
          {isBusy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Add to Apple Wallet</Text>
          )}
        </Pressable>

        <Text style={styles.body}>
          Tip: tap the pass in Wallet to flip it over for support contact info.
        </Text>
      </View>
    </View>
  );
}
