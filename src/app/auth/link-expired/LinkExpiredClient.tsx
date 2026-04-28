"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, Captcha, CaptchaRef, Input, InlineBanner } from "@/components/ui";
import { useCaptcha } from "@/hooks/useCaptcha";
import { useTranslations } from "next-intl";

interface LinkExpiredClientProps {
  captchaSiteKey: string;
  redirectTo: string;
  prefilledEmail: string;
}

export function LinkExpiredClient({ captchaSiteKey, redirectTo, prefilledEmail }: LinkExpiredClientProps) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState(prefilledEmail);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captchaRef = useRef<CaptchaRef>(null);
  const { token: captchaToken, isVerified, onVerify, onExpire, onError: onCaptchaError } = useCaptcha();

  const handleResend = async () => {
    setError(null);
    setResendMessage(null);

    if (!email.trim()) {
      setError(t("emailLabel"));
      return;
    }
    if (!isVerified || !captchaToken) {
      setError(t("completeCaptcha"));
      return;
    }

    setIsResending(true);
    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          captchaToken,
          redirect: redirectTo,
        }),
      });

      if (response.ok) {
        setResendMessage(t("resendConfirmationSent"));
      } else {
        setResendMessage(t("resendConfirmationFailed"));
      }
    } catch {
      setResendMessage(t("resendConfirmationFailed"));
    } finally {
      setIsResending(false);
      captchaRef.current?.reset();
    }
  };

  return (
    <Card className="p-6">
      <p className="text-white/70 mb-6">{t("linkExpiredBody")}</p>

      {error && (
        <InlineBanner variant="error" className="mb-4">
          {error}
        </InlineBanner>
      )}
      {resendMessage && (
        <InlineBanner variant="success" className="mb-4" data-testid="link-expired-message">
          {resendMessage}
        </InlineBanner>
      )}

      <div className="space-y-4">
        <Input
          label={t("emailLabel")}
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-testid="link-expired-email"
        />

        <div className="flex justify-center">
          <Captcha
            siteKey={captchaSiteKey}
            ref={captchaRef}
            onVerify={onVerify}
            onExpire={onExpire}
            onError={onCaptchaError}
            theme="dark"
          />
        </div>

        <Button
          type="button"
          className="w-full"
          isLoading={isResending}
          disabled={!isVerified || isResending}
          onClick={handleResend}
          data-testid="link-expired-resend"
        >
          {isResending ? t("resendingConfirmation") : t("resendConfirmation")}
        </Button>

        <div className="text-center text-sm text-white/50">
          {t("supportContactPrefix")}{" "}
          <a href="mailto:mleonard@myteamnetwork.com" className="text-white hover:underline">
            mleonard@myteamnetwork.com
          </a>
        </div>

        <div className="text-center text-sm text-white/50">
          <Link href="/auth/login" className="text-white font-medium hover:underline">
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </Card>
  );
}
