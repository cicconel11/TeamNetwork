import { AuthHeader } from "@/components/auth/AuthHeader";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getCaptchaSiteKey } from "@/lib/security/captcha";
import { getTranslations } from "next-intl/server";
import { LinkExpiredClient } from "./LinkExpiredClient";

export const dynamic = "force-dynamic";

export default async function LinkExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; email?: string }>;
}) {
  const captchaSiteKey = getCaptchaSiteKey();
  const t = await getTranslations("auth");
  const params = await searchParams;
  const redirectTo = sanitizeRedirectPath(params?.redirect ?? null);
  const prefilledEmail = typeof params?.email === "string" ? params.email : "";

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("linkExpiredTitle")} />
        <LinkExpiredClient
          captchaSiteKey={captchaSiteKey}
          redirectTo={redirectTo}
          prefilledEmail={prefilledEmail}
        />
      </div>
    </div>
  );
}
