"use client";

import { useState, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, HCaptcha, HCaptchaRef } from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import { sanitizeRedirectPath, buildRecoveryRedirectTo } from "@/lib/auth/redirect";
import { forgotPasswordSchema, type ForgotPasswordForm } from "@/lib/schemas/auth";

interface ForgotPasswordFormProps {
  hcaptchaSiteKey: string;
}

function ForgotPasswordFormComponent({ hcaptchaSiteKey }: ForgotPasswordFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const captchaRef = useRef<HCaptchaRef>(null);
  const { token: captchaToken, isVerified, onVerify, onExpire, onError } = useCaptcha();

  const searchParams = useSearchParams();
  const redirect = sanitizeRedirectPath(searchParams.get("redirect"));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");

  const onSubmit = async (data: ForgotPasswordForm) => {
    if (!isVerified || !captchaToken) {
      setError("Please complete the captcha verification");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient()!;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(data.email, {
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
        <div data-testid="forgot-password-error" className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {message && (
        <div data-testid="forgot-password-success" className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {message}
        </div>
      )}

      <form data-testid="forgot-password-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            data-testid="forgot-password-email"
            {...register("email")}
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
            data-testid="forgot-password-submit"
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
      <ForgotPasswordFormComponent hcaptchaSiteKey={hcaptchaSiteKey} />
    </Suspense>
  );
}
