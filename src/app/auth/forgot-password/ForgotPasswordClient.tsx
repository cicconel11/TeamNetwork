"use client";

import { useState, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, HCaptcha, HCaptchaRef } from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import { sanitizeRedirectPath, buildRecoveryRedirectTo } from "@/lib/auth/redirect";

interface ForgotPasswordFormProps {
  hcaptchaSiteKey: string;
}

function ForgotPasswordForm({ hcaptchaSiteKey }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const captchaRef = useRef<HCaptchaRef>(null);
  const { token: captchaToken, isVerified, onVerify, onExpire, onError } = useCaptcha();

  const searchParams = useSearchParams();
  const redirect = sanitizeRedirectPath(searchParams.get("redirect"));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isVerified || !captchaToken) {
      setError("Please complete the captcha verification");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient()!;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildRecoveryRedirectTo(siteUrl, redirect),
      captchaToken,
    });

    if (resetError) {
      setError(resetError.message);
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    setMessage("Check your email for a password reset link!");
    setIsLoading(false);
    captchaRef.current?.reset();
  };

  return (
    <Card className="p-6">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {message && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <div className="flex justify-center">
            <HCaptcha
              siteKey={hcaptchaSiteKey}
              ref={captchaRef}
              onVerify={onVerify}
              onExpire={onExpire}
              onError={onError}
              theme="light"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            isLoading={isLoading}
            disabled={!isVerified}
          >
            Send Reset Link
          </Button>
        </div>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Remember your password?{" "}
        <Link href="/auth/login" className="text-foreground font-medium hover:underline">
          Sign in
        </Link>
      </div>
    </Card>
  );
}

export function ForgotPasswordClient({ hcaptchaSiteKey }: ForgotPasswordFormProps) {
  return (
    <Suspense fallback={
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-10 bg-muted rounded-xl" />
        </div>
      </Card>
    }>
      <ForgotPasswordForm hcaptchaSiteKey={hcaptchaSiteKey} />
    </Suspense>
  );
}
