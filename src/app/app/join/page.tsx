"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, HCaptcha, HCaptchaRef } from "@/components/ui";
import { FeedbackButton } from "@/components/feedback";
import { EnterpriseOrgPicker } from "@/components/enterprise/EnterpriseOrgPicker";
import { useCaptcha } from "@/hooks/useCaptcha";
import { joinOrgSchema, type JoinOrgForm } from "@/lib/schemas/auth";

interface AvailableOrg {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface RedeemResult {
  success: boolean;
  error?: string;
  organization_id?: string;
  slug?: string;
  name?: string;
  organization_slug?: string;
  organization_name?: string;
  role?: string;
  already_member?: boolean;
  pending_approval?: boolean;
  status?: string;
  organizations?: AvailableOrg[];
  invite_token?: string;
}

type InviteFlow = "org" | "parent" | "enterprise";
type SupabaseBrowserClient = ReturnType<typeof createClient>;

function normalizeRedeemResult(data: unknown): RedeemResult {
  const result = (data ?? {}) as RedeemResult;
  return {
    ...result,
    slug: result.slug ?? result.organization_slug,
    name: result.name ?? result.organization_name,
  };
}

async function redeemInviteWithFallback(
  supabase: SupabaseBrowserClient,
  codeOrToken: string,
  preferredFlow: InviteFlow = "org",
): Promise<{ result: RedeemResult | null; rpcError: string | null }> {
  const trimmedCode = codeOrToken.trim();
  const flows: InviteFlow[] = preferredFlow === "enterprise"
    ? ["enterprise", "org", "parent"]
    : ["org", "parent", "enterprise"];

  let lastResult: RedeemResult | null = null;
  let lastRpcError: string | null = null;

  for (const flow of flows) {
    if (flow === "enterprise") {
      const { data, error } = await supabase.rpc("redeem_enterprise_invite", {
        p_code_or_token: trimmedCode,
      });

      if (error) {
        lastRpcError = error.message;
        continue;
      }

      const normalized = normalizeRedeemResult(data);
      lastResult = normalized;
      if (normalized.success) {
        return { result: normalized, rpcError: null };
      }
      continue;
    }

    if (flow === "parent") {
      const { data, error } = await supabase.rpc("redeem_parent_invite", {
        p_code: trimmedCode,
      });

      if (error) {
        lastRpcError = error.message;
        continue;
      }

      const normalized = normalizeRedeemResult(data);
      lastResult = normalized;
      if (normalized.success) {
        return { result: normalized, rpcError: null };
      }
      continue;
    }

    const { data, error } = await supabase.rpc("redeem_org_invite", {
      p_code: trimmedCode,
    });

    if (error) {
      lastRpcError = error.message;
      continue;
    }

    const normalized = normalizeRedeemResult(data);
    lastResult = normalized;
    if (normalized.success) {
      return { result: normalized, rpcError: null };
    }
  }

  if (lastResult) {
    return { result: lastResult, rpcError: null };
  }

  return { result: null, rpcError: "Invalid invite code. Please check the code and try again." };
}

function JoinOrgFormComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");
  const tokenFromUrl = searchParams.get("token");
  const inviteType = searchParams.get("invite");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ orgName: string } | null>(null);
  const [pendingTokenSubmit, setPendingTokenSubmit] = useState(false);
  const [chooseOrgState, setChooseOrgState] = useState<{
    organizations: AvailableOrg[];
    role: string;
    inviteToken: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<JoinOrgForm>({
    resolver: zodResolver(joinOrgSchema),
    defaultValues: { code: "" },
  });

  const code = watch("code");

  // Captcha state management
  const captchaRef = useRef<HCaptchaRef>(null);
  const { token: captchaToken, isVerified, onVerify, onExpire, onError: onCaptchaError } = useCaptcha();

  // Auto-fill code from URL and optionally auto-submit
  useEffect(() => {
    if (tokenFromUrl && !code) {
      // For token-based invites, we need captcha verification first
      // Set pending state to show captcha before processing
      setPendingTokenSubmit(true);
    } else if (codeFromUrl && !code) {
      setValue("code", codeFromUrl.toUpperCase());
      // Don't auto-submit for code-based invites - user needs to complete captcha first
    }
  }, [codeFromUrl, tokenFromUrl, code, setValue]);

  // Process token-based invite after captcha verification
  useEffect(() => {
    const processTokenInvite = async () => {
      if (!pendingTokenSubmit || !isVerified || !tokenFromUrl) return;

      setIsLoading(true);
      setError(null);
      setPendingTokenSubmit(false);

      const supabase = createClient();

      // Check if user is logged in
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be logged in to join an organization");
        setIsLoading(false);
        captchaRef.current?.reset();
        return;
      }

      const preferredFlow: InviteFlow = inviteType === "enterprise" ? "enterprise" : "org";
      const { result, rpcError } = await redeemInviteWithFallback(supabase, tokenFromUrl, preferredFlow);

      if (rpcError) {
        setError(rpcError);
        setIsLoading(false);
        captchaRef.current?.reset();
        return;
      }

      if (!result?.success) {
        setError(result?.error || "Failed to join organization");
        setIsLoading(false);
        captchaRef.current?.reset();
        return;
      }

      // Handle enterprise-wide invite: user must choose an org
      if (result.status === "choose_org" && result.organizations && result.invite_token) {
        setChooseOrgState({
          organizations: result.organizations,
          role: result.role || "active_member",
          inviteToken: result.invite_token,
        });
        setIsLoading(false);
        return;
      }

      // Handle already a member
      if (result.already_member) {
        if (result.status === "pending") {
          setPendingApproval({ orgName: result.name || "the organization" });
        } else {
          setError("You are already a member of this organization.");
          setTimeout(() => {
            if (result.slug) {
              router.push(`/${result.slug}`);
            }
          }, 1500);
        }
        setIsLoading(false);
        return;
      }

      // Handle pending approval
      if (result.pending_approval) {
        setPendingApproval({ orgName: result.name || "the organization" });
        setIsLoading(false);
        return;
      }

      // Success - redirect to organization
      if (result.slug) {
        router.push(`/${result.slug}`);
      }
      setIsLoading(false);
    };

    processTokenInvite();
  }, [pendingTokenSubmit, isVerified, tokenFromUrl, inviteType, router]);

  const redeemInvite = async (inviteCode: string) => {
    // Require captcha verification before submission
    if (!isVerified || !captchaToken) {
      setError("Please complete the captcha verification");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Check if user is logged in
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be logged in to join an organization");
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    const { result, rpcError } = await redeemInviteWithFallback(supabase, inviteCode, "org");

    if (rpcError) {
      setError(rpcError);
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    if (!result?.success) {
      setError(result?.error || "Failed to join organization");
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    // Handle enterprise-wide invite: user must choose an org
    if (result.status === "choose_org" && result.organizations && result.invite_token) {
      setChooseOrgState({
        organizations: result.organizations,
        role: result.role || "active_member",
        inviteToken: result.invite_token,
      });
      setIsLoading(false);
      return;
    }

    // Handle already a member
    if (result.already_member) {
      if (result.status === "pending") {
        setPendingApproval({ orgName: result.name || "the organization" });
      } else {
        setError("You are already a member of this organization.");
        setTimeout(() => {
          if (result.slug) {
            router.push(`/${result.slug}`);
          }
        }, 1500);
      }
      setIsLoading(false);
      return;
    }

    // Handle pending approval
    if (result.pending_approval) {
      setPendingApproval({ orgName: result.name || "the organization" });
      setIsLoading(false);
      return;
    }

    // Success - redirect to organization
    if (result.slug) {
      router.push(`/${result.slug}`);
    }
    setIsLoading(false);
  };

  const handleOrgSelected = async (orgId: string) => {
    if (!chooseOrgState) return;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
      setError("Invalid organization selection");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { data, error: rpcError } = await supabase.rpc("complete_enterprise_invite_redemption", {
      p_token: chooseOrgState.inviteToken,
      p_organization_id: orgId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    const result = data as RedeemResult | null;

    if (!result?.success) {
      setError(result?.error || "Failed to join organization");
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    // Success - redirect to chosen organization
    const slug = result.organization_slug ?? result.slug;
    if (slug) {
      router.push(`/${slug}`);
    }
    setIsLoading(false);
  };

  const onSubmit = async (data: JoinOrgForm) => {
    await redeemInvite(data.code);
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
          {chooseOrgState ? (
            // Enterprise-wide invite: choose org
            <div>
              <div className="text-center mb-6">
                <div className="h-16 w-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <EnterpriseOrgPicker
                organizations={chooseOrgState.organizations}
                role={chooseOrgState.role}
                isLoading={isLoading}
                onSelect={handleOrgSelected}
              />
            </div>
          ) : pendingApproval ? (
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
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Link href="/app">
                  <Button variant="secondary">
                    Back to Dashboard
                  </Button>
                </Link>
                <FeedbackButton context="join-org" trigger="pending_approval" />
              </div>
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
                  {tokenFromUrl && !isVerified
                    ? "Complete the captcha verification to continue."
                    : tokenFromUrl && isVerified
                    ? "Processing your invite link..."
                    : "Enter the invite code you received from an organization admin."}
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                  {error}
                  <div className="mt-2 flex justify-end">
                    <FeedbackButton context="join-org" trigger="invite_error" />
                  </div>
                </div>
              )}

              {!tokenFromUrl && (
                <form id="join-form" onSubmit={handleSubmit(onSubmit)}>
                  <div className="space-y-6">
                    <Input
                      label="Invite Code"
                      type="text"
                      placeholder="ABCD1234"
                      className="text-center text-2xl tracking-widest font-mono"
                      error={errors.code?.message}
                      {...register("code", {
                        onChange: (e) => {
                          e.target.value = e.target.value.toUpperCase();
                        },
                      })}
                    />

                    <div className="flex justify-center">
                      <HCaptcha
                        ref={captchaRef}
                        onVerify={onVerify}
                        onExpire={onExpire}
                        onError={onCaptchaError}
                        theme="light"
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full" 
                      isLoading={isLoading}
                      disabled={!isVerified}
                    >
                      Join Organization
                    </Button>
                  </div>
                </form>
              )}

              {tokenFromUrl && (
                <div className="space-y-6">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
                    </div>
                  ) : (
                    <>
                      <p className="text-center text-muted-foreground">
                        Complete the captcha to join the organization.
                      </p>
                      <div className="flex justify-center">
                        <HCaptcha
                          ref={captchaRef}
                          onVerify={onVerify}
                          onExpire={onExpire}
                          onError={onCaptchaError}
                          theme="light"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-border text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  Want to create your own organization instead?
                </p>
                <Link href="/app/create">
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
      <JoinOrgFormComponent />
    </Suspense>
  );
}
