"use client";

import { useState } from "react";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";

interface PhilanthropyEventOption {
  id: string;
  title: string;
}

interface DonationFormProps {
  organizationId?: string;
  philanthropyEventsForForm?: PhilanthropyEventOption[];
}

// Lightweight placeholder to satisfy build; full Stripe donation flow can be wired later.
export function DonationForm({ philanthropyEventsForForm }: DonationFormProps) {
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("general");
  const [note, setNote] = useState("");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasEvents = (philanthropyEventsForForm ?? []).length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("Donations checkout endpoint is not enabled in this build.");
    setIsLoading(false);
  };

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Make a Donation</h3>
        <p className="text-sm text-muted-foreground">Support this organization or a specific philanthropy event.</p>
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

        <Select
          label="Purpose"
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value);
            if (e.target.value !== "event") setEventId(undefined);
          }}
          options={[
            { label: "General Donation", value: "general" },
            ...(hasEvents ? [{ label: "Philanthropy Event", value: "event" }] : []),
            { label: "Other", value: "other" },
          ]}
        />

        {purpose === "event" && hasEvents && (
          <Select
            label="Select Event"
            value={eventId ?? ""}
            onChange={(e) => setEventId(e.target.value)}
            options={[
              { label: "Choose an event", value: "" },
              ...(philanthropyEventsForForm ?? []).map((evt) => ({ label: evt.title, value: evt.id })),
            ]}
            required
          />
        )}

        <Textarea
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add a message for the admins"
        />

        {message && (
          <div className="text-sm text-muted-foreground">{message}</div>
        )}

        <Button type="submit" className="w-full" isLoading={isLoading}>
          Continue
        </Button>
      </form>
    </Card>
  );
}







