import { useCallback, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { createOrgSchema } from "@teammeet/validation";
import type { CreateOrgForm } from "@teammeet/validation";
import { mapAlumniSeatsToBucket } from "@teammeet/core/pricing/per-user";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

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

const clampSeats = (raw: string): number => {
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 999_999);
};

const SALES_EMAIL = "cicconel@myteamnetwork.com";

function buildPricingMailto(input: {
  name: string;
  slug: string;
  description: string;
  activeSeats: number;
  alumniSeats: number;
}) {
  const subject = encodeURIComponent(`TeamNetwork pricing request: ${input.name}`);
  const body = encodeURIComponent(
    [
      "Hi TeamNetwork,",
      "",
      "I'd like contract pricing for a new organization.",
      "",
      `Organization: ${input.name}`,
      `Slug: ${input.slug}`,
      `Active members: ${input.activeSeats}`,
      `Alumni: ${input.alumniSeats}`,
      input.description.trim() ? `Description: ${input.description.trim()}` : null,
      "",
      "Please send pricing and next steps.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return `mailto:${SALES_EMAIL}?subject=${subject}&body=${body}`;
}

function buildSalesMailto() {
  const subject = encodeURIComponent("TeamNetwork: new organization inquiry");
  const body = encodeURIComponent(
    [
      "Hi TeamNetwork,",
      "",
      "I'd like to set up a new organization. Here are a few details:",
      "",
      "Organization name:",
      "Approx. active members:",
      "Approx. alumni:",
      "What you're hoping to use TeamNetwork for:",
      "",
      "Thanks!",
    ].join("\n"),
  );

  return `mailto:${SALES_EMAIL}?subject=${subject}&body=${body}`;
}

export default function CreateOrgScreen() {
  const router = useRouter();
  const { neutral } = useAppColorScheme();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1e3a5f");
  const [activeSeatsInput, setActiveSeatsInput] = useState("");
  const [alumniSeatsInput, setAlumniSeatsInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSeats = clampSeats(activeSeatsInput);
  const alumniSeats = clampSeats(alumniSeatsInput);
  const alumniBucket = mapAlumniSeatsToBucket(alumniSeats);

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
    pricingLabel: { ...TYPOGRAPHY.bodySmall, color: n.muted },
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

  const handleContactSales = useCallback(async () => {
    setError(null);
    const url = buildSalesMailto();
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setError(`Couldn't open your email app. Please contact ${SALES_EMAIL}.`);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Couldn't open your email app. Please contact ${SALES_EMAIL}.`,
      );
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const parsed = createOrgSchema.safeParse({
      name,
      slug,
      description: description.trim() ? description : undefined,
      primaryColor,
      billingInterval: "month",
      alumniBucket,
      withTrial: false,
    } satisfies CreateOrgForm);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please fix form errors.");
      return;
    }

    setIsSubmitting(true);
    try {
      const url = buildPricingMailto({
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description ?? "",
        activeSeats,
        alumniSeats,
      });
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setError("Couldn't open your email app. Please contact sales@myteamnetwork.com.");
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't open your email app."
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    name,
    slug,
    description,
    primaryColor,
    alumniBucket,
    activeSeats,
    alumniSeats,
  ]);

  // Apple Guideline 3.1.1 (anti-steering): iOS clients cannot initiate a
  // paid subscription, and we don't steer to an external web checkout. New
  // organizations are set up by our team, so iOS shows a Contact Sales action
  // that opens the mail composer in-app (no browser, no checkout).
  if (Platform.OS === "ios") {
    return (
      <View style={styles.container}>
        <View style={styles.sheetHeader}>
          <Pressable
            onPress={handleCancel}
            style={styles.headerSideButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.headerSideButtonText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Create Organization</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.contentSheet}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.stepHeading}>Contact our sales team</Text>
            <Text style={styles.stepSubhead}>
              New organizations are set up by the TeamNetwork team. Reach out
              and we&apos;ll get you started with the right plan for your group.
            </Text>
            {error != null && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <Pressable
              onPress={handleContactSales}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Contact sales"
            >
              <Text style={styles.primaryButtonText}>Contact Sales</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    );
  }

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
              {step === 1 ? "Your Organization" : "Pricing Request"}
            </Text>
            <Text style={styles.stepSubhead}>
              {step === 1
                ? "Set up your team or group. You'll be the admin."
                : "Share your network size so we can prepare contract pricing."}
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
                  Current roster, staff, volunteers, or active community members.
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
                  Past members, graduates, supporters, or long-term contacts.
                </Text>
              </View>

              <View style={styles.pricingCard}>
                <Text style={styles.pricingTitle}>Contract pricing</Text>
                <Text style={styles.pricingLabel}>
                  We no longer show self-serve rates here. Send us your org
                  details and we'll follow up with pricing based on your size,
                  modules, support needs, and rollout timing.
                </Text>
              </View>

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
                  <Text style={styles.primaryButtonText}>
                    {isSubmitting ? "Opening email..." : "Contact us for pricing"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
