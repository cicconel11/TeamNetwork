"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { newExpenseSchema, type NewExpenseForm } from "@/lib/schemas/content";

export default function NewExpensePage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<NewExpenseForm>({
    resolver: zodResolver(newExpenseSchema),
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
          setValue("name", profile.name);
        }
      }
    };

    load();
  }, [orgSlug, setValue]);

  const onSubmit = async (data: NewExpenseForm) => {
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

    const { error: insertError } = await supabase.from("expenses").insert({
      organization_id: orgIdToUse,
      user_id: user.id,
      name: data.name,
      expense_type: data.expense_type,
      amount: parseFloat(data.amount),
      venmo_link: data.venmo_link || null,
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
              Submit Expense
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
