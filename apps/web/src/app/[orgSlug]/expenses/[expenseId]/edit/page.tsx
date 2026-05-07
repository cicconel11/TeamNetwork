"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editExpenseSchema, type EditExpenseForm } from "@/lib/schemas/content";

export default function EditExpensePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const expenseId = params.expenseId as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditExpenseForm>({
    resolver: zodResolver(editExpenseSchema),
    defaultValues: {
      name: "",
      expense_type: "",
      amount: "",
      venmo_link: "",
    },
  });

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

      reset({
        name: expense.name || "",
        expense_type: expense.expense_type || "",
        amount: expense.amount?.toString() || "",
        venmo_link: expense.venmo_link || "",
      });
      setIsFetching(false);
    };

    load();
  }, [orgSlug, expenseId, reset]);

  const onSubmit = async (data: EditExpenseForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const amount = parseFloat(data.amount);

    const { error: updateError } = await supabase
      .from("expenses")
      .update({
        name: data.name,
        expense_type: data.expense_type,
        amount: amount,
        venmo_link: data.venmo_link || null,
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
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Name"
            placeholder="Person requesting reimbursement"
            error={errors.name?.message}
            {...register("name")}
          />

          <Input
            label="Expense"
            placeholder="e.g., Travel, Equipment, Food"
            error={errors.expense_type?.message}
            {...register("expense_type")}
          />

          <Input
            label="Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            error={errors.amount?.message}
            {...register("amount")}
          />

          <Input
            label="Venmo Request Link"
            type="text"
            placeholder="https://venmo.com/..."
            helperText="Paste your Venmo payment request link"
            error={errors.venmo_link?.message}
            {...register("venmo_link")}
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
