import { useCallback, useState } from "react";
import * as Crypto from "expo-crypto";
import { initStripe, useStripe } from "@stripe/stripe-react-native";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";

const PLATFORM_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const MERCHANT_IDENTIFIER = "merchant.com.myteamnetwork.teammeet";
const URL_SCHEME = "teammeet";

type StartDonationInput = {
  organizationId: string;
  organizationSlug: string;
  amount: number;
  donorName?: string;
  donorEmail?: string;
  purpose?: string;
  captchaToken: string;
};

type StartDonationResult =
  | { status: "completed"; paymentAttemptId: string }
  | { status: "canceled" }
  | { status: "ineligible_ios" }
  | { status: "error"; message: string };

type PaymentSheetResponse = {
  mode: "payment_sheet";
  paymentIntentClientSecret: string;
  ephemeralKeySecret: string;
  customerId: string;
  stripeAccountId: string;
  paymentAttemptId: string;
  idempotencyKey: string;
};

/**
 * Drives the Apple Pay / Stripe Payment Sheet flow for org donations. Calls
 * the platform `create-donation` API with `mode=payment_sheet` + an `x-platform`
 * header so the server can apply Guideline 3.2.1(vi) eligibility gating.
 */
export function useDonationPaymentSheet() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isProcessing, setIsProcessing] = useState(false);

  const start = useCallback(
    async (input: StartDonationInput): Promise<StartDonationResult> => {
      if (!PLATFORM_PUBLISHABLE_KEY) {
        return {
          status: "error",
          message: "Payments are not configured in this build.",
        };
      }
      setIsProcessing(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userEmail = sessionData.session?.user?.email || undefined;

        const idempotencyKey = Crypto.randomUUID();
        const response = await fetchWithAuth("/api/stripe/create-donation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-platform": "ios",
          },
          body: JSON.stringify({
            organizationId: input.organizationId,
            organizationSlug: input.organizationSlug,
            amount: input.amount,
            donorName: input.donorName,
            donorEmail: input.donorEmail || userEmail,
            purpose: input.purpose,
            mode: "payment_sheet",
            captchaToken: input.captchaToken,
            idempotencyKey,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as
          | (PaymentSheetResponse & { reason?: string })
          | { error?: string; reason?: string; details?: string[] };

        if (!response.ok) {
          if ("reason" in data && data.reason === "org_not_eligible_ios") {
            return { status: "ineligible_ios" };
          }
          const detailSuffix =
            "details" in data && Array.isArray(data.details) && data.details.length > 0
              ? ` (${data.details.join(", ")})`
              : "";
          return {
            status: "error",
            message: `${("error" in data && data.error) || "Unable to start donation."}${detailSuffix}`,
          };
        }

        const sheet = data as PaymentSheetResponse;

        // Direct charges settle on the org's connected account, so the
        // PaymentSheet must confirm against that account. `stripeAccountId`
        // belongs to the SDK's init params (StripeProvider / initStripe), NOT
        // to initPaymentSheet — passing it to initPaymentSheet is silently
        // ignored, leaving the sheet bound to the platform account and
        // producing "The client_secret provided does not match any associated
        // PaymentIntent on this account". Re-init the SDK with the connected
        // account for the duration of this payment, then restore the platform
        // context so subsequent donations to other orgs are not routed wrong.
        try {
          await initStripe({
            publishableKey: PLATFORM_PUBLISHABLE_KEY,
            stripeAccountId: sheet.stripeAccountId,
            merchantIdentifier: MERCHANT_IDENTIFIER,
            urlScheme: URL_SCHEME,
          });

          const initResult = await initPaymentSheet({
            merchantDisplayName: "TeamNetwork",
            customerId: sheet.customerId,
            customerEphemeralKeySecret: sheet.ephemeralKeySecret,
            paymentIntentClientSecret: sheet.paymentIntentClientSecret,
            applePay: { merchantCountryCode: "US" },
            allowsDelayedPaymentMethods: false,
            returnURL: "teammeet://stripe-redirect",
          });
          if (initResult.error) {
            return { status: "error", message: initResult.error.message };
          }

          const presentResult = await presentPaymentSheet();
          if (presentResult.error) {
            if (presentResult.error.code === "Canceled") {
              return { status: "canceled" };
            }
            return { status: "error", message: presentResult.error.message };
          }

          return { status: "completed", paymentAttemptId: sheet.paymentAttemptId };
        } finally {
          // Restore the platform-scoped SDK context regardless of outcome.
          await initStripe({
            publishableKey: PLATFORM_PUBLISHABLE_KEY,
            merchantIdentifier: MERCHANT_IDENTIFIER,
            urlScheme: URL_SCHEME,
          });
        }
      } catch (e) {
        return {
          status: "error",
          message: (e as Error).message || "Unable to complete donation.",
        };
      } finally {
        setIsProcessing(false);
      }
    },
    [initPaymentSheet, presentPaymentSheet],
  );

  return { start, isProcessing };
}
