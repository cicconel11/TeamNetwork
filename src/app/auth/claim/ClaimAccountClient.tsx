"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  Button,
  Captcha,
  CaptchaRef,
  Card,
  InlineBanner,
  Input,
} from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import { buildAuthLink, sanitizeRedirectPath } from "@/lib/auth/redirect";
import {
  claimEmailSchema,
  claimOtpSchema,
  type ClaimEmailForm,
  type ClaimOtpForm,
} from "@/lib/schemas/auth";
import { claimAlumniProfile } from "@/lib/auth/claim-flow";

interface ClaimAccountClientProps {
  captchaSiteKey: string;
}

type Step = "request" | "verify";

function ClaimFormComponent({ captchaSiteKey }: ClaimAccountClientProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");
  const redirectFromUrl = sanitizeRedirectPath(searchParams.get("redirect"));

  const [step, setStep] = useState<Step>("request");
  const [pendingEmail, setPendingEmail] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const captchaRef = useRef<CaptchaRef>(null);
  const {
    token: captchaToken,
    isVerified,
    onVerify,
    onExpire,
    onError,
  } = useCaptcha();

  const emailForm = useForm<ClaimEmailForm>({
    resolver: zodResolver(claimEmailSchema),
    defaultValues: { email: "" },
  });

  const otpForm = useForm<ClaimOtpForm>({
    resolver: zodResolver(claimOtpSchema),
    defaultValues: { token: "" },
  });

  // After OTP verification, claimAlumniProfile auto-grants org membership for
  // every admin-imported alumni row matching the verified email (R4 redefined:
  // the import IS the grant; OTP just unlocks it). Users with no matching
  // alumni row fall back to /app/join for invite redemption.
  const buildJoinFallbackUrl = (): string => {
    const params = new URLSearchParams();
    if (codeFromUrl) params.set("code", codeFromUrl);
    if (redirectFromUrl && redirectFromUrl !== "/app") {
      params.set("next", redirectFromUrl);
    }
    const qs = params.toString();
    return qs ? `/app/join?${qs}` : "/app/join";
  };

  const onRequestSubmit = async (data: ClaimEmailForm) => {
    if (!isVerified || !captchaToken) {
      setError(t("completeCaptcha"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient()!;
    // SECURITY: this OTP step proves email ownership. After verifyOtp the
    // server action claimAlumniProfile grants membership ONLY for
    // admin-imported alumni rows matching the verified email. Magic-link sign
    // in alone still grants zero membership; the prior admin import is the
    // grant, OTP just unlocks it.
    //
    // Code-flow (no email link) avoids the prefetch problem where Apple Mail
    // / link scanners consume the single-use token before the user clicks it.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: data.email,
      options: {
        captchaToken,
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      const status = (otpError as { status?: number }).status;
      const code = (otpError as { code?: string }).code ?? "";
      if (
        status === 429 ||
        /rate.?limit/i.test(code) ||
        /rate.?limit/i.test(otpError.message)
      ) {
        setError(t("claimRateLimited"));
      } else {
        setError(t("claimError"));
      }
      setIsLoading(false);
      captchaRef.current?.reset();
      return;
    }

    // Generic message regardless of whether the email exists — closes
    // enumeration via differential responses.
    setPendingEmail(data.email);
    setStep("verify");
    setMessage(t("claimCodeSent"));
    setIsLoading(false);
    captchaRef.current?.reset();
  };

  const onVerifySubmit = async (data: ClaimOtpForm) => {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient()!;
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: data.token,
      type: "email",
    });

    if (verifyError) {
      setError(t("claimInvalidCode"));
      setIsLoading(false);
      return;
    }

    try {
      const { orgs } = await claimAlumniProfile(pendingEmail);

      if (orgs.length === 0) {
        router.push(buildJoinFallbackUrl());
        return;
      }

      if (orgs.length === 1) {
        router.push(`/${orgs[0].slug}`);
        return;
      }

      router.push("/app");
    } catch {
      setError(t("claimError"));
      setIsLoading(false);
    }
  };

  const onResend = async () => {
    if (!pendingEmail) return;
    setStep("request");
    setError(null);
    setMessage(null);
    otpForm.reset();
    emailForm.setValue("email", pendingEmail);
  };

  return (
    <Card className="p-5 sm:p-6">
      {error && (
        <InlineBanner
          variant="error"
          data-testid="claim-error"
          className="mb-4"
          aria-live="polite"
        >
          {error}
        </InlineBanner>
      )}

      {message && (
        <InlineBanner
          variant="success"
          data-testid="claim-success"
          className="mb-4"
          aria-live="polite"
        >
          {message}
        </InlineBanner>
      )}

      {step === "request" ? (
        <form
          data-testid="claim-form"
          onSubmit={emailForm.handleSubmit(onRequestSubmit)}
        >
          <div className="space-y-2.5">
            <Input
              label={t("emailLabel")}
              type="email"
              placeholder={t("emailPlaceholder")}
              data-testid="claim-email"
              autoComplete="email"
              inputMode="email"
              error={emailForm.formState.errors.email?.message}
              {...emailForm.register("email")}
            />

            <div className="flex justify-center">
              <Captcha
                siteKey={captchaSiteKey}
                ref={captchaRef}
                onVerify={onVerify}
                onExpire={onExpire}
                onError={onError}
                theme="dark"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              isLoading={isLoading}
              disabled={!isVerified}
              data-testid="claim-submit"
            >
              {t("claimSendCode")}
            </Button>
          </div>
        </form>
      ) : (
        <form
          data-testid="claim-verify-form"
          onSubmit={otpForm.handleSubmit(onVerifySubmit)}
        >
          <div className="space-y-2.5">
            <Input
              label={t("claimCodeLabel")}
              type="text"
              placeholder={t("claimCodePlaceholder")}
              data-testid="claim-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={8}
              error={otpForm.formState.errors.token?.message}
              {...otpForm.register("token")}
            />

            <Button
              type="submit"
              className="w-full"
              isLoading={isLoading}
              data-testid="claim-verify"
            >
              {t("claimVerify")}
            </Button>

            <button
              type="button"
              onClick={onResend}
              className="w-full text-center text-sm text-white/50 hover:text-white/80"
            >
              {t("claimResend")}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 text-center text-sm text-white/50">
        {t("haveAccount")}{" "}
        <Link
          href={buildAuthLink("/auth/login", redirectFromUrl)}
          className="text-white font-medium hover:underline"
        >
          {t("signIn")}
        </Link>
      </div>
    </Card>
  );
}

export function ClaimAccountClient({ captchaSiteKey }: ClaimAccountClientProps) {
  return (
    <Suspense
      fallback={
        <Card className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-white/5 rounded-xl" />
            <div className="h-10 bg-white/5 rounded-xl" />
          </div>
        </Card>
      }
    >
      <ClaimFormComponent captchaSiteKey={captchaSiteKey} />
    </Suspense>
  );
}
