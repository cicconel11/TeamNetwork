"use client";

import { useState } from "react";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";

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
  const [amount, setAmount] = useState("");
  const [designation, setDesignation] = useState<"general" | "event" | "other">("general");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasEvents = (philanthropyEventsForForm ?? []).length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Enter a donation amount greater than zero.");
      setIsLoading(false);
      return;
    }

    if (!isStripeConnected) {
      setError("Stripe donations are not enabled yet. Ask an admin to connect Stripe.");
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
          ? "Philanthropy event donation"
          : designation === "other"
            ? "Directed donation"
            : "General support"),
      mode: "checkout",
    };

    try {
      const res = await fetch("/api/stripe/create-donation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to start Stripe Checkout");
      }

      if (data.url) {
        window.location.href = data.url as string;
        return;
      }

      setMessage("Donation intent created. Complete payment via Stripe.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Donate with Stripe</h3>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be redirected to Stripe Checkout. Funds go straight to the organization.
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${isStripeConnected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {isStripeConnected ? "Stripe Connected" : "Setup Required"}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Amount (USD)"
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Donor name"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            placeholder="Jane Doe"
          />
          <Input
            label="Email for receipt"
            type="email"
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            placeholder="donor@example.com"
          />
        </div>

        <Select
          label="Designation"
          value={designation}
          onChange={(e) => {
            const next = (e.target.value || "general") as "general" | "event" | "other";
            setDesignation(next);
            if (next !== "event") setEventId(undefined);
          }}
          options={[
            { label: "General support", value: "general" },
            ...(hasEvents ? [{ label: "Specific philanthropy event", value: "event" }] : []),
            { label: "Other purpose", value: "other" },
          ]}
        />

        {designation === "event" && hasEvents && (
          <Select
            label="Choose event"
            value={eventId ?? ""}
            onChange={(e) => setEventId(e.target.value)}
            options={[
              { label: "Select an event", value: "" },
              ...(philanthropyEventsForForm ?? []).map((evt) => ({ label: evt.title, value: evt.id })),
            ]}
            required
          />
        )}

        <Textarea
          label="Note or purpose (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add a message for the admins or describe the designation"
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

        <Button type="submit" className="w-full" isLoading={isLoading} disabled={!isStripeConnected}>
          Donate with Stripe
        </Button>
      </form>
    </Card>
  );
}






