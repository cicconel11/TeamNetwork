"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Donation } from "@/types/database";

export default function EditDonationPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const donationId = params.donationId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    donor_name: "",
    donor_email: "",
    amount: "",
    date: "",
    campaign: "",
    notes: "",
  });

  useEffect(() => {
    const fetchDonation = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }

      const { data: donation } = await supabase
        .from("donations")
        .select("*")
        .eq("id", donationId)
        .eq("organization_id", org.id)
        .single();

      if (!donation) {
        setError("Donation not found");
        setIsFetching(false);
        return;
      }

      const d = donation as Donation;
      setFormData({
        donor_name: d.donor_name || "",
        donor_email: d.donor_email || "",
        amount: d.amount?.toString() || "",
        date: d.date ? d.date.split("T")[0] : "",
        campaign: d.campaign || "",
        notes: d.notes || "",
      });
      setIsFetching(false);
    };

    fetchDonation();
  }, [orgSlug, donationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .single();

    if (!org) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("donations")
      .update({
        donor_name: formData.donor_name,
        donor_email: formData.donor_email || null,
        amount: parseFloat(formData.amount),
        date: formData.date,
        campaign: formData.campaign || null,
        notes: formData.notes || null,
      })
      .eq("id", donationId)
      .eq("organization_id", org.id);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/donations`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Edit Donation"
          description="Loading..."
          backHref={`/${orgSlug}/donations`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Donation"
        description="Update donation details"
        backHref={`/${orgSlug}/donations`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Donor Name"
            value={formData.donor_name}
            onChange={(e) => setFormData({ ...formData, donor_name: e.target.value })}
            placeholder="e.g., John Doe, Alumni Foundation"
            required
          />

          <Input
            label="Donor Email"
            type="email"
            value={formData.donor_email}
            onChange={(e) => setFormData({ ...formData, donor_email: e.target.value })}
            placeholder="donor@example.com"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Amount ($)"
              type="number"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              placeholder="100.00"
              min="0"
              step="0.01"
              required
            />
            <Input
              label="Date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>

          <Input
            label="Campaign"
            value={formData.campaign}
            onChange={(e) => setFormData({ ...formData, campaign: e.target.value })}
            placeholder="e.g., Spring Campaign, Equipment Fund"
            helperText="Leave blank for general donations"
          />

          <Textarea
            label="Notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Any additional notes about this donation..."
            rows={3}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}




