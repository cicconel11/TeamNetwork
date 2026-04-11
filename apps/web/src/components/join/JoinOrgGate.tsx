"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, HCaptcha, HCaptchaRef } from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import {
  redeemInviteWithFallback,
  type RedeemResult,
} from "@/lib/invites/redeemInvite";

interface JoinOrgGateProps {
  orgName: string;
  orgSlug: string;
}

function JoinOrgGateInner({ orgName }: JoinOrgGateProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");
  const tokenFromUrl = searchParams.get("token");

  const [inviteCode, setInviteCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [success, setSuccess] = useState(false);
  const [autoProcessing, setAutoProcessing] = useState(false);

  const captchaRef = useRef<HCaptchaRef>(null);
  const { isVerified, onVerify, onExpire, onError: onCaptchaError } = useCaptcha();
  const processedRef = useRef(false);

  const hasUrlCode = Boolean(codeFromUrl || tokenFromUrl);

  useEffect(() => {
    if (codeFromUrl && !inviteCode) {
      setInviteCode(codeFromUrl.toUpperCase());
    }
  }, [codeFromUrl, inviteCode]);

  useEffect(() => {
    if (!isVerified || processedRef.current || !hasUrlCode) return;

    const code = tokenFromUrl || codeFromUrl;
    if (!code) return;

    processedRef.current = true;
    setAutoProcessing(true);
    processInviteCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerified, hasUrlCode]);

  async function processInviteCode(code: string) {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You must be logged in to join. Please sign in and try again.");
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    const { result, rpcError } = await redeemInviteWithFallback(supabase, code, "org");

    if (rpcError) {
      setError(rpcError);
      setIsLoading(false);
      captchaRef.current?.reset();
      processedRef.current = false;
      return;
    }

    if (!result?.success) {
      setError(result?.error || "Failed to join organization");
      setIsLoading(false);
      captchaRef.current?.reset();
      processedRef.current = false;
      return;
    }

    handleRedeemSuccess(result);
  }

  function handleRedeemSuccess(result: RedeemResult) {
    if (result.already_member) {
      if (result.status === "pending") {
        setPendingApproval(true);
      } else {
        setSuccess(true);
        setTimeout(() => router.refresh(), 500);
      }
      setIsLoading(false);
      return;
    }

    if (result.pending_approval) {
      setPendingApproval(true);
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
    router.refresh();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isVerified) {
      setError("Please complete the captcha verification");
      return;
    }

    const trimmed = inviteCode.trim();
    if (!trimmed) {
      setError("Please enter an invite code");
      return;
    }

    await processInviteCode(trimmed);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Welcome!</h2>
          <p className="text-muted-foreground">
            You&apos;ve joined <span className="font-semibold text-foreground">{orgName}</span>. Loading your organization...
          </p>
          <div className="mt-4 flex justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500" />
          </div>
        </Card>
      </div>
    );
  }

  if (pendingApproval) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Request Sent!</h2>
          <p className="text-muted-foreground mb-6">
            Your request to join <span className="font-semibold text-foreground">{orgName}</span> has been submitted.
          </p>
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm mb-6">
            <p className="font-medium mb-1">Awaiting Admin Approval</p>
            <p className="text-amber-600 dark:text-amber-400">
              An admin will review your request and grant you access.
            </p>
          </div>
          <Link href="/app">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
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

      <main className="max-w-md mx-auto px-6 py-12">
        <div className="mb-8">
          <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <Card className="p-8">
          <div className="text-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Join {orgName}
            </h2>
            <p className="text-muted-foreground">
              {autoProcessing && isLoading
                ? "Processing your invite link..."
                : hasUrlCode && !isVerified
                ? "Complete the captcha verification to continue."
                : "Enter the invite code you received from an admin to join this organization."}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {hasUrlCode && !autoProcessing ? (
            <div className="space-y-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
                </div>
              ) : (
                <>
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
          ) : autoProcessing && isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="space-y-6">
                <Input
                  label="Invite Code"
                  type="text"
                  placeholder="ABCD1234"
                  className="text-center text-2xl tracking-widest font-mono"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
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
                  Join {orgName}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}

export function JoinOrgGate(props: JoinOrgGateProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse">
            <div className="h-8 w-48 bg-muted rounded-xl" />
          </div>
        </div>
      }
    >
      <JoinOrgGateInner {...props} />
    </Suspense>
  );
}
