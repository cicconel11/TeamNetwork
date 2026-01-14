"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function EditExpensePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const expenseId = params.expenseId as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    expense_type: "",
    amount: "",
    venmo_link: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
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

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }
      setOrgId(org.id);

      // Get expense
      const { data: expense, error: fetchError } = await supabase
        .from("expenses")
        .select("*")
        .eq("id", expenseId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (fetchError || !expense) {
        setError("Expense not found");
        setIsFetching(false);
        return;
      }

      setFormData({
        name: expense.name || "",
        expense_type: expense.expense_type || "",
        amount: expense.amount?.toString() || "",
        venmo_link: expense.venmo_link || "",
      });
      setIsFetching(false);
    };

    load();
  }, [orgSlug, expenseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount greater than 0");
      setIsLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("expenses")
      .update({
        name: formData.name,
        expense_type: formData.expense_type,
        amount: amount,
        venmo_link: formData.venmo_link || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", expenseId)
      .eq("organization_id", orgId);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/expenses`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Edit Expense"
          description="Loading..."
          backHref={`/${orgSlug}/expenses`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
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
        title="Edit Expense"
        description="Update expense details"
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
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
