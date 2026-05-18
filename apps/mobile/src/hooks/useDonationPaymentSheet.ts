import { useCallback, useState } from "react";
import * as Crypto from "expo-crypto";
import { useStripe } from "@stripe/stripe-react-native";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";

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
        const initResult = await initPaymentSheet({
          merchantDisplayName: "TeamNetwork",
          customerId: sheet.customerId,
          customerEphemeralKeySecret: sheet.ephemeralKeySecret,
          paymentIntentClientSecret: sheet.paymentIntentClientSecret,
          applePay: { merchantCountryCode: "US" },
          // Direct charges on a Connect account require routing the
          // confirmation call to that account.
          // @ts-expect-error - stripeAccountId is supported in 0.65+ but
          // missing from the older type bundled by Expo's resolution.
          stripeAccountId: sheet.stripeAccountId,
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
