"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewExpensePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    expense_type: "",
    amount: "",
    venmo_link: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      // Get org
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;
      setOrgId(org.id);

      // Get current user's name for auto-fill
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.name) {
          setFormData((prev) => ({ ...prev, name: profile.name || "" }));
        }
      }
    };

    load();
  }, [orgSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be logged in to submit an expense");
      setIsLoading(false);
      return;
    }

    const orgIdToUse = orgId
      ? orgId
      : (await supabase.from("organizations").select("id").eq("slug", orgSlug).maybeSingle()).data?.id;

    if (!orgIdToUse) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount greater than 0");
      setIsLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("expenses").insert({
      organization_id: orgIdToUse,
      user_id: user.id,
      name: formData.name,
      expense_type: formData.expense_type,
      amount: amount,
      venmo_link: formData.venmo_link || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/expenses`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Submit Expense"
        description="Request reimbursement for an expense"
        backHref={`/${orgSlug}/expenses`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Person requesting reimbursement"
            required
          />

          <Input
            label="Expense"
            value={formData.expense_type}
            onChange={(e) => setFormData({ ...formData, expense_type: e.target.value })}
            placeholder="e.g., Travel, Equipment, Food"
            required
          />

          <Input
            label="Amount"
            type="number"
            step="0.01"
            min="0.01"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            placeholder="0.00"
            required
          />

          <Input
            label="Venmo Request Link"
            type="text"
            value={formData.venmo_link}
            onChange={(e) => setFormData({ ...formData, venmo_link: e.target.value })}
            placeholder="https://venmo.com/..."
            helperText="Paste your Venmo payment request link"
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Submit Expense
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
