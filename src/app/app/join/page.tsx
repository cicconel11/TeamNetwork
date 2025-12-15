"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card } from "@/components/ui";

function JoinOrgForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");
  const tokenFromUrl = searchParams.get("token");
  
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ orgName: string } | null>(null);

  // Auto-fill code from URL and optionally auto-submit
  useEffect(() => {
    if (tokenFromUrl && !code) {
      // For token-based invites, we auto-submit immediately
      setAutoSubmitting(true);
    } else if (codeFromUrl && !code) {
      setCode(codeFromUrl.toUpperCase());
      setAutoSubmitting(true);
    }
  }, [codeFromUrl, tokenFromUrl, code]);

  // Auto-submit when code is filled from URL or token is present
  useEffect(() => {
    const processAutoSubmit = async () => {
      if (!autoSubmitting) return;

      if (tokenFromUrl) {
        setIsLoading(true);
        setError(null);

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError("You must be logged in to join an organization");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f6fe50b5-6abd-4a79-8685-54d1dabba251',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'join/page.tsx:50',message:'Before token lookup query',data:{tokenFromUrl:tokenFromUrl?.slice(0,8)+'...'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        const { data: inviteData, error: inviteError } = await supabase
          .from("organization_invites")
          .select(`*, organizations (id, name, slug)`)
          .eq("token", tokenFromUrl)
          .single();

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f6fe50b5-6abd-4a79-8685-54d1dabba251',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'join/page.tsx:60',message:'After token lookup query',data:{hasData:!!inviteData,error:inviteError?.message||null},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        if (inviteError || !inviteData) {
          setError("Invalid invite link. Please check and try again.");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }

        const invite = inviteData as {
          id: string;
          organization_id: string;
          role: string;
          uses_remaining: number | null;
          expires_at: string | null;
          revoked_at: string | null;
          organizations: { id: string; name: string; slug: string };
        };

        if (invite.revoked_at) {
          setError("This invite has been revoked.");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          setError("This invite has expired.");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }
        if (invite.uses_remaining !== null && invite.uses_remaining <= 0) {
          setError("This invite has no uses remaining.");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }

        const { data: existingRole } = await supabase
          .from("user_organization_roles")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("organization_id", invite.organization_id)
          .single();

        if (existingRole) {
          if ((existingRole as { status: string }).status === "revoked") {
            setError("Your access to this organization has been revoked. Contact an admin.");
          } else {
            setError("You are already a member of this organization.");
            setTimeout(() => router.push(`/${invite.organizations.slug}`), 1500);
          }
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }

        let role = invite.role;
        if (role === "member") role = "active_member";
        if (role === "viewer") role = "alumni";

        const { error: roleError } = await supabase
          .from("user_organization_roles")
          .insert({ user_id: user.id, organization_id: invite.organization_id, role, status: "pending" });

        if (roleError) {
          setError("Failed to join organization. Please try again.");
          setIsLoading(false);
          setAutoSubmitting(false);
          return;
        }

        if (invite.uses_remaining !== null) {
          await supabase
            .from("organization_invites")
            .update({ uses_remaining: invite.uses_remaining - 1 })
            .eq("id", invite.id)
            .gt("uses_remaining", 0);
        }

        // Show pending approval message instead of redirecting
        setPendingApproval({ orgName: invite.organizations.name });
        setIsLoading(false);
      } else if (code) {
        const form = document.getElementById("join-form") as HTMLFormElement;
        if (form) form.requestSubmit();
      }
      setAutoSubmitting(false);
    };

    processAutoSubmit();
  }, [autoSubmitting, code, tokenFromUrl, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be logged in to join an organization");
      setIsLoading(false);
      return;
    }

    // Look up the invite code
    const { data: inviteData, error: inviteError } = await supabase
      .from("organization_invites")
      .select(`
        *,
        organizations (
          id,
          name,
          slug
        )
      `)
      .eq("code", code.trim().toUpperCase())
      .single();

    if (inviteError || !inviteData) {
      setError("Invalid invite code. Please check and try again.");
      setIsLoading(false);
      return;
    }

    await processInvite(supabase, inviteData, user);
  };

  const processInvite = async (
    supabase: ReturnType<typeof createClient>,
    inviteData: {
      id: string;
      organization_id: string;
      code: string;
      token: string | null;
      role: string;
      uses_remaining: number | null;
      expires_at: string | null;
      revoked_at: string | null;
      organizations: { id: string; name: string; slug: string };
    },
    user: { id: string }
  ) => {
    const invite = inviteData;

    // Check if invite has been revoked
    if (invite.revoked_at) {
      setError("This invite has been revoked.");
      setIsLoading(false);
      return;
    }

    // Check if invite has expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      setError("This invite has expired.");
      setIsLoading(false);
      return;
    }

    // Check if invite has uses remaining
    if (invite.uses_remaining !== null && invite.uses_remaining <= 0) {
      setError("This invite has no uses remaining.");
      setIsLoading(false);
      return;
    }

    // Check if user is already a member
    const { data: existingRole } = await supabase
      .from("user_organization_roles")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("organization_id", invite.organization_id)
      .single();

    if (existingRole) {
      if (existingRole.status === "revoked") {
        setError("Your access to this organization has been revoked. Contact an admin.");
      } else {
        setError("You are already a member of this organization.");
        // Redirect them anyway after a short delay
        setTimeout(() => router.push(`/${invite.organizations.slug}`), 1500);
      }
      setIsLoading(false);
      return;
    }

    // Map role if needed (legacy support)
    let role = invite.role;
    if (role === "member") role = "active_member";
    if (role === "viewer") role = "alumni";

    // Add user to organization with the role specified in the invite (pending status)
    const { error: roleError } = await supabase
      .from("user_organization_roles")
      .insert({
        user_id: user.id,
        organization_id: invite.organization_id,
        role: role,
        status: "pending",
      });

    if (roleError) {
      setError("Failed to join organization. Please try again.");
      setIsLoading(false);
      return;
    }

    // Decrement uses_remaining if it's set (atomic update)
    if (invite.uses_remaining !== null) {
      await supabase
        .from("organization_invites")
        .update({ uses_remaining: invite.uses_remaining - 1 })
        .eq("id", invite.id)
        .gt("uses_remaining", 0);
    }

    // Show pending approval message instead of redirecting
    setPendingApproval({ orgName: invite.organizations.name });
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">
              Sign Out
            </Button>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </Link>
        </div>

        <Card className="p-8">
          {pendingApproval ? (
            // Pending approval success state
            <div className="text-center">
              <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Request Sent!</h2>
              <p className="text-muted-foreground mb-6">
                Your request to join <span className="font-semibold text-foreground">{pendingApproval.orgName}</span> has been submitted.
              </p>
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm mb-6">
                <p className="font-medium mb-1">Awaiting Admin Approval</p>
                <p className="text-amber-600 dark:text-amber-400">
                  An admin will review your request and grant you access. You&apos;ll be able to access the organization once approved.
                </p>
              </div>
              <Link href="/app">
                <Button variant="secondary">
                  Back to Dashboard
                </Button>
              </Link>
            </div>
          ) : (
            // Join form state
            <>
              <div className="text-center mb-8">
                <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Join an Organization</h2>
                <p className="text-muted-foreground">
                  {tokenFromUrl 
                    ? "Processing your invite link..."
                    : "Enter the invite code you received from an organization admin."}
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              {!tokenFromUrl && (
                <form id="join-form" onSubmit={handleSubmit}>
                  <div className="space-y-6">
                    <Input
                      label="Invite Code"
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABCD1234"
                      className="text-center text-2xl tracking-widest font-mono"
                      required
                    />

                    <Button type="submit" className="w-full" isLoading={isLoading}>
                      Join Organization
                    </Button>
                  </div>
                </form>
              )}

              {tokenFromUrl && isLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-border text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  Want to create your own organization instead?
                </p>
                <Link href="/app/create-org">
                  <Button variant="secondary" size="sm">
                    Create Organization
                  </Button>
                </Link>
              </div>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}

export default function JoinOrgPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-muted rounded-xl" />
        </div>
      </div>
    }>
      <JoinOrgForm />
    </Suspense>
  );
}
