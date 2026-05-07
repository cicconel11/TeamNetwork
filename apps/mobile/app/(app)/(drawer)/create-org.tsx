import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { createOrgSchema } from "@teammeet/validation";
import type { CreateOrgForm, SubscriptionInterval } from "@teammeet/validation";
import {
  calcPerUserQuote,
  formatCents,
  formatRateCents,
  isPerUserSalesLed,
  mapAlumniSeatsToBucket,
} from "@teammeet/core/pricing/per-user";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { fetchWithAuth } from "@/lib/web-api";
import { useCreateOrgIdempotencyKey } from "@/hooks/useCreateOrgIdempotencyKey";
import { useOrganizations } from "@/hooks/useOrganizations";

const ORG_TRIAL_DAYS = 30;

const isOrgFreeTrialSelectable = (
  billingInterval: SubscriptionInterval,
  salesLed: boolean
): boolean => billingInterval === "month" && !salesLed;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();

const BRAND_PRESETS = [
  "#1e3a5f",
  "#0f766e",
  "#7c3aed",
  "#dc2626",
  "#ea580c",
  "#0284c7",
];

const BILLING_OPTIONS: { value: SubscriptionInterval; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly (save 2 months)" },
];

const clampSeats = (raw: string): number => {
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 999_999);
};

export default function CreateOrgScreen() {
  const router = useRouter();
  const { neutral } = useAppColorScheme();
  const { refetch: refetchOrganizations } = useOrganizations();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1e3a5f");
  const [billingInterval, setBillingInterval] =
    useState<SubscriptionInterval>("month");
  const [activeSeatsInput, setActiveSeatsInput] = useState("");
  const [alumniSeatsInput, setAlumniSeatsInput] = useState("");
  const [withTrial, setWithTrial] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(
    null
  );
  const [pendingCheckoutSlug, setPendingCheckoutSlug] = useState<string | null>(
    null
  );

  const activeSeats = useMemo(() => clampSeats(activeSeatsInput), [activeSeatsInput]);
  const alumniSeats = useMemo(() => clampSeats(alumniSeatsInput), [alumniSeatsInput]);
  const salesLed = isPerUserSalesLed(alumniSeats);
  const alumniBucket = useMemo(
    () => mapAlumniSeatsToBucket(alumniSeats),
    [alumniSeats],
  );
  const quote = useMemo(
    () => calcPerUserQuote(billingInterval, activeSeats, alumniSeats),
    [billingInterval, activeSeats, alumniSeats],
  );

  const trialEligible = isOrgFreeTrialSelectable(billingInterval, salesLed);
  const effectiveWithTrial = trialEligible && withTrial;

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        primaryColor,
        billingInterval,
        alumniBucket,
        activeSeats,
        alumniSeats,
        withTrial: effectiveWithTrial,
      }),
    [
      name,
      slug,
      description,
      primaryColor,
      billingInterval,
      alumniBucket,
      activeSeats,
      alumniSeats,
      effectiveWithTrial,
    ]
  );

  const { idempotencyKey, refreshKey, clearKey } = useCreateOrgIdempotencyKey({
    fingerprint,
  });

  const styles = useThemedStyles((n, s) => ({
    container: { flex: 1, backgroundColor: n.background },
    sheetHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      minHeight: 48,
      backgroundColor: n.surface,
      borderBottomWidth: 1,
      borderBottomColor: n.border,
    },
    headerSideButton: {
      paddingVertical: SPACING.xs,
      paddingRight: SPACING.sm,
      minWidth: 56,
    },
    headerSideButtonText: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
    },
    headerTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      flex: 1,
      textAlign: "center" as const,
      fontWeight: "600" as const,
    },
    headerSpacer: { width: 56 },
    contentSheet: { flex: 1, backgroundColor: n.surface },
    scrollContent: {
      padding: SPACING.md,
      paddingBottom: SPACING.xxl,
      gap: SPACING.lg,
    },
    stepLabel: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    stepHeading: {
      ...TYPOGRAPHY.titleLarge,
      color: n.foreground,
    },
    stepSubhead: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.muted,
      marginTop: SPACING.xs,
    },
    errorCard: {
      backgroundColor: s.errorLight,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: s.error,
    },
    errorText: { ...TYPOGRAPHY.bodySmall, color: s.error },
    fieldGroup: { gap: SPACING.xs },
    fieldLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.secondary,
    },
    helperText: {
      ...TYPOGRAPHY.labelSmall,
      color: n.muted,
    },
    required: { color: s.error },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      ...TYPOGRAPHY.bodyMedium,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    textArea: { minHeight: 96 },
    swatchRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    swatch: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.full,
      borderWidth: 2,
      borderColor: "transparent",
    },
    swatchSelected: {
      borderColor: n.foreground,
    },
    chipRow: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: SPACING.sm,
    },
    chip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    chipSelected: {
      borderColor: s.success,
      backgroundColor: s.successLight,
    },
    chipText: { ...TYPOGRAPHY.labelMedium, color: n.foreground },
    chipTextSelected: { color: s.successDark, fontWeight: "600" as const },
    pricingCard: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      backgroundColor: n.background,
      gap: SPACING.xs,
    },
    pricingTitle: {
      ...TYPOGRAPHY.labelLarge,
      color: n.foreground,
      marginBottom: SPACING.xs,
    },
    pricingRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
    },
    pricingLabel: { ...TYPOGRAPHY.bodySmall, color: n.muted },
    pricingValue: { ...TYPOGRAPHY.bodySmall, color: n.foreground },
    pricingDivider: {
      height: 1,
      backgroundColor: n.border,
      marginVertical: SPACING.xs,
    },
    pricingTotalLabel: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "600" as const,
    },
    pricingTotalValue: {
      ...TYPOGRAPHY.labelMedium,
      color: n.foreground,
      fontWeight: "700" as const,
    },
    warningBanner: {
      backgroundColor: s.warningLight,
      borderWidth: 1,
      borderColor: s.warning,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
    },
    warningText: { ...TYPOGRAPHY.bodySmall, color: s.warningDark },
    trialCard: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    trialRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: SPACING.md,
    },
    trialTitle: { ...TYPOGRAPHY.labelMedium, color: n.foreground },
    trialBody: { ...TYPOGRAPHY.bodySmall, color: n.muted },
    trialNote: { ...TYPOGRAPHY.bodySmall, color: s.successDark },
    trialToggle: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: n.border,
    },
    trialToggleOn: {
      backgroundColor: s.success,
      borderColor: s.success,
    },
    trialToggleText: { ...TYPOGRAPHY.labelSmall, color: n.foreground },
    trialToggleTextOn: { color: "#ffffff", fontWeight: "600" as const },
    buttonRow: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      paddingTop: SPACING.sm,
    },
    secondaryButton: {
      flex: 1,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: { ...TYPOGRAPHY.labelLarge, color: n.foreground },
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      borderRadius: RADIUS.md,
      paddingVertical: SPACING.md,
      alignItems: "center" as const,
    },
    primaryButtonPressed: { opacity: 0.9 },
    primaryButtonText: { ...TYPOGRAPHY.labelLarge, color: "#ffffff" },
    buttonDisabled: { opacity: 0.6 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      justifyContent: "center" as const,
      alignItems: "center" as const,
      padding: SPACING.lg,
    },
    modalCard: {
      width: "100%" as const,
      maxWidth: 420,
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      padding: SPACING.lg,
      gap: SPACING.md,
    },
    modalTitle: {
      ...TYPOGRAPHY.titleMedium,
      color: n.foreground,
      fontWeight: "700" as const,
    },
    modalBody: {
      ...TYPOGRAPHY.bodyMedium,
      color: n.secondary,
    },
    modalButtons: {
      flexDirection: "row" as const,
      gap: SPACING.sm,
      marginTop: SPACING.xs,
    },
  }));

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!slugTouched) {
        setSlug(slugify(value));
      }
    },
    [slugTouched]
  );

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true);
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  }, []);

  const handleColorTextChange = useCallback((value: string) => {
    setPrimaryColor(value.startsWith("#") ? value : `#${value}`);
  }, []);

  const validateStep1 = useCallback((): string | null => {
    const result = createOrgSchema
      .pick({ name: true, slug: true, description: true, primaryColor: true })
      .safeParse({
        name,
        slug,
        description: description.trim() ? description : undefined,
        primaryColor,
      });
    if (!result.success) {
      return result.error.issues[0]?.message ?? "Please fix form errors.";
    }
    return null;
  }, [name, slug, description, primaryColor]);

  const handleNext = useCallback(() => {
    const msg = validateStep1();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setStep(2);
  }, [validateStep1]);

  const handleBack = useCallback(() => {
    setError(null);
    setStep(1);
  }, []);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  const navigateAfterCheckout = useCallback(
    async (targetSlug: string) => {
      try {
        await refetchOrganizations();
      } catch {
        // best effort; banner fallback handles webhook lag
      }
      // Brief delay so the just-refetched list (if reconciled) has the new org.
      // If still missing, leave the user on the org list with a finalizing banner.
      router.replace({
        pathname: "/(app)/(drawer)",
        params: { pendingFinalize: targetSlug },
      } as never);
    },
    [refetchOrganizations, router]
  );

  const handleSubmit = useCallback(async () => {
    setError(null);

    const parsed = createOrgSchema.safeParse({
      name,
      slug,
      description: description.trim() ? description : undefined,
      primaryColor,
      billingInterval,
      alumniBucket,
      withTrial: effectiveWithTrial,
    } satisfies CreateOrgForm);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please fix form errors.");
      return;
    }

    if (!idempotencyKey) {
      setError("Preparing checkout… please try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetchWithAuth(
        "/api/stripe/create-org-v2-checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parsed.data.name,
            slug: parsed.data.slug,
            description: parsed.data.description,
            primaryColor: parsed.data.primaryColor,
            billingInterval: parsed.data.billingInterval,
            actives: activeSeats,
            alumni: alumniSeats,
            idempotencyKey,
          }),
        }
      );

      const data = (await response.json().catch(() => null)) as
        | { mode?: "sales"; url?: string; organizationSlug?: string; error?: string }
        | null;

      if (!response.ok) {
        const message = data?.error ?? "Unable to start checkout.";
        if (response.status === 409) {
          // slug collision — let the user edit and retry with a fresh key
          await refreshKey();
        }
        setError(message);
        return;
      }

      if (data?.mode === "sales") {
        await clearKey();
        router.replace({
          pathname: "/(app)/(drawer)",
          params: { pendingSales: parsed.data.slug },
        } as never);
        return;
      }

      if (data?.url) {
        // Defer the open to the disclosure modal so reviewers see an
        // explicit "leaving the app for billing" step before Safari opens.
        setPendingCheckoutUrl(data.url);
        setPendingCheckoutSlug(parsed.data.slug);
        return;
      }

      setError("Checkout response missing URL.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    name,
    slug,
    description,
    primaryColor,
    billingInterval,
    alumniBucket,
    effectiveWithTrial,
    idempotencyKey,
    refreshKey,
    clearKey,
    router,
  ]);

  const handleConfirmCheckout = useCallback(async () => {
    if (!pendingCheckoutUrl || !pendingCheckoutSlug) return;
    const targetSlug = pendingCheckoutSlug;
    const targetUrl = pendingCheckoutUrl;
    try {
      const supported = await Linking.canOpenURL(targetUrl);
      if (!supported) {
        setError("Couldn't open the browser. Please try again.");
        return;
      }
      await Linking.openURL(targetUrl);
      // The user is now in Safari. Idempotency key is intentionally retained
      // until they return — if Stripe checkout fails or they back out, the
      // same fingerprint resolves to the same payment_attempts row on retry.
      setPendingCheckoutUrl(null);
      setPendingCheckoutSlug(null);
      await navigateAfterCheckout(targetSlug);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't open the browser."
      );
    }
  }, [
    pendingCheckoutUrl,
    pendingCheckoutSlug,
    navigateAfterCheckout,
  ]);

  const handleCancelCheckout = useCallback(() => {
    setPendingCheckoutUrl(null);
    setPendingCheckoutSlug(null);
  }, []);

  const intervalSuffix = billingInterval === "month" ? "/mo" : "/yr";

  const submitLabel = effectiveWithTrial
    ? `Start ${ORG_TRIAL_DAYS}-Day Free Trial`
    : salesLed
      ? "Request custom plan"
      : "Create Organization";

  return (
    <View style={styles.container}>
      <View style={styles.sheetHeader}>
        <Pressable
          onPress={step === 1 ? handleCancel : handleBack}
          style={styles.headerSideButton}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Cancel" : "Back"}
        >
          <Text style={styles.headerSideButtonText}>
            {step === 1 ? "Cancel" : "Back"}
          </Text>
        </Pressable>
        <Text style={styles.headerTitle}>Create Organization</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={styles.stepLabel}>Step {step} of 2</Text>
            <Text style={styles.stepHeading}>
              {step === 1 ? "Your Organization" : "Plan & Billing"}
            </Text>
            <Text style={styles.stepSubhead}>
              {step === 1
                ? "Set up your team or group. You'll be the admin."
                : "Choose your billing plan and alumni access level."}
            </Text>
          </View>

          {error != null && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {step === 1 && (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Organization name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  value={name}
                  onChangeText={handleNameChange}
                  placeholder="e.g. Stanford Crew"
                  placeholderTextColor={neutral.placeholder}
                  style={styles.input}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  URL slug <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  value={slug}
                  onChangeText={handleSlugChange}
                  placeholder="my-organization"
                  placeholderTextColor={neutral.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Text style={styles.helperText}>
                  Your org will live at myteamnetwork.com/{slug || "your-slug"}
                </Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Tell people about your organization..."
                  placeholderTextColor={neutral.placeholder}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, styles.textArea]}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Brand color</Text>
                <View style={styles.swatchRow}>
                  {BRAND_PRESETS.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => setPrimaryColor(color)}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose color ${color}`}
                      accessibilityState={{
                        selected: primaryColor.toLowerCase() === color.toLowerCase(),
                      }}
                      style={[
                        styles.swatch,
                        { backgroundColor: color },
                        primaryColor.toLowerCase() === color.toLowerCase() &&
                          styles.swatchSelected,
                      ]}
                    />
                  ))}
                </View>
                <TextInput
                  value={primaryColor}
                  onChangeText={handleColorTextChange}
                  placeholder="#1e3a5f"
                  placeholderTextColor={neutral.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              <View style={styles.buttonRow}>
                <Pressable
                  onPress={handleCancel}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleNext}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Next</Text>
                </Pressable>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Billing interval</Text>
                <View style={styles.chipRow}>
                  {BILLING_OPTIONS.map((option) => {
                    const selected = billingInterval === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setBillingInterval(option.value)}
                        style={[styles.chip, selected && styles.chipSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selected && styles.chipTextSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Active members</Text>
                <TextInput
                  value={activeSeatsInput}
                  onChangeText={setActiveSeatsInput}
                  placeholder="0"
                  placeholderTextColor={neutral.placeholder}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.input}
                />
                <Text style={styles.helperText}>
                  1–100 at $0.15/mo each, 101–500 at $0.10, 501+ at $0.05
                </Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Alumni</Text>
                <TextInput
                  value={alumniSeatsInput}
                  onChangeText={setAlumniSeatsInput}
                  placeholder="0"
                  placeholderTextColor={neutral.placeholder}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.input}
                />
                <Text style={styles.helperText}>
                  1–500 at $0.36/mo each, 501–2,500 at $0.25, 2,501–10,000 at $0.18
                </Text>
              </View>

              <View style={styles.pricingCard}>
                <Text style={styles.pricingTitle}>Pricing summary</Text>
                {salesLed ? (
                  <Text style={styles.pricingLabel}>
                    10,000+ alumni — we'll reach out with custom pricing.
                  </Text>
                ) : quote ? (
                  <>
                    <View style={styles.pricingRow}>
                      <Text style={styles.pricingLabel}>
                        Active members ({activeSeats.toLocaleString()} ×{" "}
                        {formatRateCents(quote.activeRateCents)})
                      </Text>
                      <Text style={styles.pricingValue}>
                        {formatCents(quote.activeSubtotalCents)}
                        {intervalSuffix}
                      </Text>
                    </View>
                    {alumniSeats > 0 && (
                      <View style={styles.pricingRow}>
                        <Text style={styles.pricingLabel}>
                          Alumni ({alumniSeats.toLocaleString()} ×{" "}
                          {formatRateCents(quote.alumniRateCents)})
                        </Text>
                        <Text style={styles.pricingValue}>
                          {formatCents(quote.alumniSubtotalCents)}
                          {intervalSuffix}
                        </Text>
                      </View>
                    )}
                    <View style={styles.pricingDivider} />
                    <View style={styles.pricingRow}>
                      <Text style={styles.pricingTotalLabel}>Total</Text>
                      <Text style={styles.pricingTotalValue}>
                        {formatCents(quote.totalCents)}
                        {intervalSuffix}
                      </Text>
                    </View>
                    {billingInterval === "year" && (
                      <Text style={styles.helperText}>
                        Yearly billing saves 17% (2 months free).
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.pricingLabel}>
                    Enter member counts above to see your price.
                  </Text>
                )}
              </View>

              {salesLed && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningText}>
                    For 10,000+ alumni, we'll contact you with custom pricing. No
                    payment is collected now and the org will remain pending sales.
                  </Text>
                </View>
              )}

              {trialEligible && (
                <View style={styles.trialCard}>
                  <View style={styles.trialRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trialTitle}>
                        {ORG_TRIAL_DAYS}-day free trial
                      </Text>
                      <Text style={styles.trialBody}>
                        Card collected now. Billing starts when trial ends unless
                        you cancel.
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setWithTrial((v) => !v)}
                      style={[
                        styles.trialToggle,
                        effectiveWithTrial && styles.trialToggleOn,
                      ]}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: effectiveWithTrial }}
                    >
                      <Text
                        style={[
                          styles.trialToggleText,
                          effectiveWithTrial && styles.trialToggleTextOn,
                        ]}
                      >
                        {effectiveWithTrial ? "On" : "Off"}
                      </Text>
                    </Pressable>
                  </View>
                  {effectiveWithTrial && (
                    <Text style={styles.trialNote}>
                      Trial selected. Org active immediately; first charge after{" "}
                      {ORG_TRIAL_DAYS} days.
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.buttonRow}>
                <Pressable
                  onPress={handleBack}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={isSubmitting}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.primaryButtonPressed,
                    isSubmitting && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>{submitLabel}</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>

      <Modal
        visible={pendingCheckoutUrl != null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelCheckout}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Continue on the web</Text>
            <Text style={styles.modalBody}>
              You'll leave the app and finish billing in your browser at
              checkout.stripe.com. After payment, return to TeamNetwork to
              manage your organization.
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={handleCancelCheckout}
                style={styles.secondaryButton}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Not now</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmCheckout}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
