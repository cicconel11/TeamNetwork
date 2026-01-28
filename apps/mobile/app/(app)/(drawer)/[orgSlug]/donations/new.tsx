import { useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  Pressable,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import { getWebAppUrl } from "@/lib/web-api";
import HCaptcha, { type HCaptchaRef } from "@/components/HCaptcha";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import { borderRadius, fontSize, fontWeight, spacing } from "@/lib/theme";

export default function NewDonationScreen() {
  const { orgId, orgSlug } = useOrg();
  const captchaRef = useRef<HCaptchaRef>(null);
  const { colors } = useOrgTheme();

  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);

    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    const amountValue = Number(amount.trim());
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a donation amount greater than zero.");
      return;
    }

    captchaRef.current?.show();
  };

  const handleCaptchaVerify = async (token: string) => {
    if (!orgId || !orgSlug) {
      setError("Organization not loaded yet.");
      return;
    }

    const amountValue = Number(amount.trim());
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a donation amount greater than zero.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userEmail = sessionData.session?.user?.email || undefined;

      const response = await fetch(`${getWebAppUrl()}/api/stripe/create-donation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: orgId,
          organizationSlug: orgSlug,
          amount: amountValue,
          donorName: donorName.trim() || undefined,
          donorEmail: donorEmail.trim() || userEmail,
          purpose: purpose.trim() || undefined,
          mode: "checkout",
          captchaToken: token,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detailSuffix = Array.isArray(data?.details) && data.details.length > 0
          ? ` (${data.details.join(", ")})`
          : "";
        throw new Error(`${data?.error || "Unable to start Stripe Checkout."}${detailSuffix}`);
      }

      if (data?.url) {
        await Linking.openURL(data.url as string);
        return;
      }

      setError("Donation intent created. Complete payment in the browser.");
    } catch (e) {
      setError((e as Error).message || "Unable to start donation checkout.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.primary }}
      contentContainerStyle={{
        padding: spacing.md,
        gap: spacing.lg,
      }}
    >
      <HCaptcha
        ref={captchaRef}
        onVerify={handleCaptchaVerify}
        onError={(message) => setError(message)}
        onExpire={() => setError("Captcha expired. Please try again.")}
        onCancel={() => setError("Captcha was canceled.")}
      />

      {error && (
        <View
          style={{
            backgroundColor: `${colors.error}20`,
            borderRadius: borderRadius.md,
            padding: spacing.sm,
          }}
        >
          <Text selectable style={{ color: colors.error, fontSize: fontSize.sm }}>
            {error}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Amount (USD)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="50"
          placeholderTextColor={colors.secondaryForeground}
          keyboardType="decimal-pad"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Donor name</Text>
        <TextInput
          value={donorName}
          onChangeText={setDonorName}
          placeholder="Jane Doe"
          placeholderTextColor={colors.secondaryForeground}
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Donor email</Text>
        <TextInput
          value={donorEmail}
          onChangeText={setDonorEmail}
          placeholder="donor@example.com"
          placeholderTextColor={colors.secondaryForeground}
          keyboardType="email-address"
          autoCapitalize="none"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
          }}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.primaryForeground }}>Purpose (optional)</Text>
        <TextInput
          value={purpose}
          onChangeText={setPurpose}
          placeholder="General support"
          placeholderTextColor={colors.secondaryForeground}
          multiline
          textAlignVertical="top"
          style={{
            borderWidth: 1,
            borderColor: colors.secondaryDark,
            borderRadius: borderRadius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.base,
            color: colors.secondaryForeground,
            backgroundColor: colors.secondary,
            minHeight: 100,
          }}
        />
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={isSaving}
        style={({ pressed }) => [{
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          paddingVertical: spacing.sm,
          alignItems: "center" as const,
          opacity: isSaving ? 0.7 : 1,
        }, pressed && { opacity: 0.7 }]}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={{ color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>
            Continue to Stripe
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
