"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Button, Input, Textarea, Select, HCaptcha } from "@/components/ui";
import { useIdempotencyKey, useCaptcha } from "@/hooks";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface PhilanthropyEventOption {
  id: string;
  title: string;
}

interface DonationFormProps {
  organizationId: string;
  organizationSlug: string;
  philanthropyEventsForForm?: PhilanthropyEventOption[];
  isStripeConnected?: boolean;
}

export function DonationForm({
  organizationId,
  organizationSlug,
  philanthropyEventsForForm,
  isStripeConnected = false,
}: DonationFormProps) {
  const tDonations = useTranslations("donations");

  const [amount, setAmount] = useState("");
  const [designation, setDesignation] = useState<"general" | "event" | "other">("general");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [note, setNote] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didTrackOpenRef = useRef(false);
  const {
    token: captchaToken,
    isVerified: isCaptchaVerified,
    onVerify: onCaptchaVerify,
    onExpire: onCaptchaExpire,
    onError: onCaptchaError,
  } = useCaptcha();
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        organizationId,
        amount: Number(amount) || 0,
        designation,
        eventId,
        purpose: note.trim() || undefined,
        donorEmail: donorEmail.trim() || undefined,
        donorName: donorName.trim() || undefined,
      }),
    [amount, designation, donorEmail, donorName, eventId, note, organizationId],
  );
  const { idempotencyKey } = useIdempotencyKey({
    storageKey: `donation:${organizationId}`,
    fingerprint,
  });

  const hasEvents = (philanthropyEventsForForm ?? []).length > 0;

  useEffect(() => {
    if (!didTrackOpenRef.current) {
      didTrackOpenRef.current = true;
      trackBehavioralEvent("donation_flow_start", {
        campaign_id: eventId ?? undefined,
      }, organizationId);
    }
  }, [eventId, organizationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    if (!isCaptchaVerified || !captchaToken) {
      setError(tDonations("captchaRequired"));
      setIsLoading(false);
      return;
    }

    if (!idempotencyKey) {
      setError(tDonations("preparingCheckout"));
      setIsLoading(false);
      return;
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError(tDonations("amountRequired"));
      setIsLoading(false);
      return;
    }

    if (!isStripeConnected) {
      setError(tDonations("stripeNotEnabled"));
      setIsLoading(false);
      return;
    }

    const body = {
      amount: amountNumber,
      organizationId,
      organizationSlug,
      donorName: donorName.trim() || undefined,
      donorEmail: donorEmail.trim() || undefined,
      eventId: designation === "event" ? eventId : undefined,
      purpose:
        note.trim() ||
        (designation === "event"
          ? tDonations("eventDonation")
          : designation === "other"
            ? tDonations("directedDonation")
            : tDonations("generalSupport")),
      mode: "checkout",
      anonymous,
      idempotencyKey,
      captchaToken,
    };

    try {
      trackBehavioralEvent("donation_checkout_start", {
        campaign_id: eventId ?? undefined,
        amount_bucket:
          amountNumber < 10 ? "<10" :
          amountNumber <= 25 ? "10-25" :
          amountNumber <= 50 ? "26-50" :
          amountNumber <= 100 ? "51-100" :
          amountNumber <= 250 ? "101-250" :
          "250+",
      }, organizationId);
      const res = await fetch("/api/stripe/create-donation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || tDonations("unableToStart"));
      }

      if (data.url) {
        window.location.href = data.url as string;
        return;
      }

      setMessage(tDonations("intentCreated"));
    } catch (err) {
      trackBehavioralEvent("donation_checkout_result", {
        campaign_id: eventId ?? undefined,
        result: "fail",
        error_code: "checkout_failed",
      }, organizationId);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{tDonations("donateWithStripe")}</h3>
          <p className="text-sm text-muted-foreground">
            {tDonations("redirectToStripe")}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${isStripeConnected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {isStripeConnected ? tDonations("stripeConnected") : tDonations("setupRequired")}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={tDonations("amountUSD")}
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={tDonations("donorName")}
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            placeholder={tDonations("donorNamePlaceholder")}
          />
          <Input
            label={tDonations("emailForReceipt")}
            type="email"
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            placeholder={tDonations("emailPlaceholder")}
          />
        </div>

        <Select
          label={tDonations("designation")}
          value={designation}
          onChange={(e) => {
            const next = (e.target.value || "general") as "general" | "event" | "other";
            setDesignation(next);
            if (next !== "event") setEventId(undefined);
          }}
          options={[
            { label: tDonations("generalSupport"), value: "general" },
            ...(hasEvents ? [{ label: tDonations("specificEvent"), value: "event" }] : []),
            { label: tDonations("otherPurpose"), value: "other" },
          ]}
        />

        {designation === "event" && hasEvents && (
          <Select
            label={tDonations("chooseEvent")}
            value={eventId ?? ""}
            onChange={(e) => setEventId(e.target.value)}
            options={[
              { label: tDonations("selectEvent"), value: "" },
              ...(philanthropyEventsForForm ?? []).map((evt) => ({ label: evt.title, value: evt.id })),
            ]}
            required
          />
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span className="text-sm text-foreground">{tDonations("donateAnonymously")}</span>
          <span className="text-xs text-muted-foreground">{tDonations("anonymousNote")}</span>
        </label>

        <Textarea
          label={tDonations("noteOptional")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={tDonations("notePlaceholder")}
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
            {message}
          </div>
        )}

        <HCaptcha
          onVerify={onCaptchaVerify}
          onExpire={onCaptchaExpire}
          onError={onCaptchaError}
        />

        <Button type="submit" className="w-full" isLoading={isLoading} disabled={!isStripeConnected || !isCaptchaVerified}>
          {tDonations("donateWithStripe")}
        </Button>
      </form>
    </Card>
  );
}
