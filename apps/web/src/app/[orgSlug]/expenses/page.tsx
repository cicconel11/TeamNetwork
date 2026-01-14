import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, EmptyState, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ExpensesFilters } from "@/components/expenses";
import { isOrgAdmin } from "@/lib/auth";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

export const dynamic = "force-dynamic";

interface ExpensesPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ user?: string; type?: string }>;
}

export default async function ExpensesPage({ params, searchParams }: ExpensesPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) return null;

  const isAdmin = await isOrgAdmin(org.id);
  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/expenses", navConfig);
  const actionLabel = resolveActionLabel("/expenses", navConfig, "Submit");

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (!user || userError) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={pageLabel}
          description="Sign in to view expenses"
          actions={
            <Link href={`/auth/login?redirect=/${orgSlug}/expenses`}>
              <Button>Sign In</Button>
            </Link>
          }
        />
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm-.38-12.516l-7.5 12.984A1.125 1.125 0 005.096 20.5h13.808a1.125 1.125 0 00.975-1.682l-7.5-12.984a1.125 1.125 0 00-1.95 0z" />
              </svg>
            }
            title="Session required"
            description={`Your session could not be verified. Refresh or sign in again to load ${pageLabel.toLowerCase()}.`}
            action={
              <Link href={`/auth/login?redirect=/${orgSlug}/expenses`}>
                <Button>Sign In</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  // Build query
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Non-admin users only see their own expenses
  if (!isAdmin && user) {
    query = query.eq("user_id", user.id);
  }

  // Admin filters
  if (isAdmin) {
    if (filters.user) {
      query = query.eq("user_id", filters.user);
    }
    if (filters.type) {
      query = query.eq("expense_type", filters.type);
    }
  }

  const { data: expenses, error: expensesError } = await query;

  if (expensesError) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={pageLabel}
          description={`Unable to load ${pageLabel.toLowerCase()}`}
          actions={
            <Link href={`/${orgSlug}/expenses/new`}>
              <Button>{actionLabel}</Button>
            </Link>
          }
        />
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75A4.5 4.5 0 008.25 9.75v6.75a4.5 4.5 0 008.25-3.75v-2.25z" />
              </svg>
            }
            title={`${pageLabel} unavailable`}
            description={
              expensesError?.message
                ? `We couldn't load ${pageLabel.toLowerCase()}: ${expensesError.message}`
                : `We couldn't load ${pageLabel.toLowerCase()} for this organization. Try refreshing the page.`
            }
          />
        </Card>
      </div>
    );
  }

  // Get unique expense types and users for admin filters
  let expenseTypes: string[] = [];
  let submitters: Array<{ id: string; name: string | null; email: string }> = [];
  let userLookup = new Map<string, { id: string; name: string | null; email: string }>();

  if (isAdmin) {
    const { data: allExpenses } = await supabase
      .from("expenses")
      .select("expense_type, user_id")
      .eq("organization_id", org.id)
      .is("deleted_at", null);

    if (allExpenses) {
      expenseTypes = [...new Set(allExpenses.map((e) => e.expense_type).filter((type) => type && type !== "test"))];

      const userIds = Array.from(new Set(allExpenses.map((e) => e.user_id).filter(Boolean))) as string[];
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, name, email")
          .in("id", userIds);

        if (users) {
          userLookup = new Map(users.map((u) => [u.id, u]));
          submitters = users.map((u) => ({ id: u.id, name: u.name, email: u.email }));
        }
      }
    }
  }

  // Calculate total
  const total = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`${expenses?.length || 0} ${pageLabel.toLowerCase()} totaling ${total.toFixed(2)}`}
        actions={
          <Link href={`/${orgSlug}/expenses/new`}>
            <Button>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {actionLabel}
            </Button>
          </Link>
        }
      />

      {/* Admin Filters */}
      {isAdmin && (expenseTypes.length > 0 || submitters.length > 0) && (
        <ExpensesFilters expenseTypes={expenseTypes} submitters={submitters} />
      )}

      {/* Expenses List */}
      {expenses && expenses.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {expenses.map((expense) => {
            const userData = userLookup.get(expense.user_id) || null;
            const canEdit = isAdmin || expense.user_id === user?.id;

            return (
              <Card key={expense.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{expense.name}</h3>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                        {expense.expense_type}
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-org-primary mt-1 font-mono">
                      ${Number(expense.amount).toFixed(2)}
                    </p>
                    {isAdmin && userData && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Submitted by {userData.name || userData.email}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {expense.created_at
                        ? new Date(expense.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {expense.venmo_link && (
                      <a
                        href={expense.venmo_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#008CFF] text-white hover:bg-[#0070CC] transition-colors"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19.5 3c.9 1.5 1.3 3.1 1.3 5.1 0 5.6-4.8 12.9-8.7 18H5.3L2.2 3.6l6.4-.6 1.5 12.1c1.4-2.3 3.1-5.9 3.1-8.4 0-1.9-.3-3.2-.8-4.2L19.5 3z"/>
                        </svg>
                        Venmo
                      </a>
                    )}
                    {canEdit && (
                      <div className="flex gap-2">
                        <Link href={`/${orgSlug}/expenses/${expense.id}/edit`}>
                          <Button variant="secondary" size="sm">
                            Edit
                          </Button>
                        </Link>
                        <SoftDeleteButton
                          table="expenses"
                          id={expense.id}
                          organizationField="organization_id"
                          organizationId={org.id}
                          label="Delete"
                          confirmMessage={`Are you sure you want to delete this ${resolveActionLabel("/expenses", navConfig, "").toLowerCase().trim()}?`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            }
            title={`No ${pageLabel.toLowerCase()} yet`}
            description={`Submit an ${resolveActionLabel("/expenses", navConfig, "").toLowerCase().trim()} to request reimbursement`}
            action={
              <Link href={`/${orgSlug}/expenses/new`}>
                <Button>{resolveActionLabel("/expenses", navConfig, "Submit First")}</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
