"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Card, InlineBanner } from "@/components/ui";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { resetPasswordSchema, type ResetPasswordForm } from "@/lib/schemas/auth";
import { useTranslations } from "next-intl";

function ResetPasswordFormComponent() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "valid" | "expired" | "error">("loading");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirectPath(searchParams.get("redirect"));

  const checkSession = async () => {
    setSessionState("loading");
    const supabase = createClient()!;
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (user) {
      setSessionState("valid");
    } else if (authError && !authError.message.includes("Auth session missing")) {
      setSessionState("error");
    } else {
      setSessionState("expired");
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const onSubmit = async (data: ResetPasswordForm) => {
    setError(null);
    setIsLoading(true);

    const supabase = createClient()!;
    const { error: updateError } = await supabase.auth.updateUser({ password: data.password });

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    setMessage(t("passwordUpdatedRedirecting"));
    setIsLoading(false);

    setTimeout(() => {
      router.push(redirect);
      router.refresh();
    }, 2000);
  };

  if (sessionState === "loading") {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-white/5 rounded-xl" />
          <div className="h-10 bg-white/5 rounded-xl" />
        </div>
      </Card>
    );
  }

  if (sessionState === "error") {
    return (
      <Card className="p-6 text-center">
        <p className="text-white/50 mb-4">
          {t("somethingWentWrong")}
        </p>
        <Button className="w-full" onClick={checkSession}>
          {tCommon("tryAgain")}
        </Button>
        <div className="mt-4 text-sm text-white/50">
          <Link href="/auth/login" className="text-white font-medium hover:underline">
            {t("backToSignIn")}
          </Link>
        </div>
      </Card>
    );
  }

  if (sessionState === "expired") {
    return (
      <Card className="p-6 text-center">
        <p className="text-white/50 mb-4">
          {t("resetLinkExpired")}
        </p>
        <Link href="/auth/forgot-password">
          <Button className="w-full">{t("requestNewLink")}</Button>
        </Link>
        <div className="mt-4 text-sm text-white/50">
          <Link href="/auth/login" className="text-white font-medium hover:underline">
            {t("backToSignIn")}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      {error && (
        <InlineBanner variant="error" className="mb-4">
          {error}
        </InlineBanner>
      )}

      {message && (
        <InlineBanner variant="success" className="mb-4">
          {message}
        </InlineBanner>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4">
          <Input
            label={t("newPassword")}
            type="password"
            placeholder={t("passwordPlaceholder")}
            error={errors.password?.message}
            {...register("password")}
          />

          <Input
            label={t("confirmPassword")}
            type="password"
            placeholder={t("passwordPlaceholder")}
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />

          <Button
            type="submit"
            className="w-full"
            isLoading={isLoading}
          >
            {t("updatePassword")}
          </Button>
        </div>
      </form>

      <div className="mt-6 text-center text-sm text-white/50">
        <Link href="/auth/login" className="text-white font-medium hover:underline">
          {t("backToSignIn")}
        </Link>
      </div>
    </Card>
  );
}

export function ResetPasswordClient() {
  return (
    <Suspense fallback={
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-white/5 rounded-xl" />
          <div className="h-10 bg-white/5 rounded-xl" />
        </div>
      </Card>
    }>
      <ResetPasswordFormComponent />
    </Suspense>
  );
}
