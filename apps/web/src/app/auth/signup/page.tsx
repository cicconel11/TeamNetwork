import { AuthHeader } from "@/components/auth/AuthHeader";
import { SignupClient } from "./SignupClient";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isLinkedInLoginEnabled } from "@/lib/linkedin/config.server";
import { isMicrosoftLoginEnabled } from "@/lib/microsoft/sso-config.server";
import { getCaptchaSiteKey } from "@/lib/security/captcha";
import { getTranslations } from "next-intl/server";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const captchaSiteKey = getCaptchaSiteKey();
  const linkedinOauthAvailable = isLinkedInLoginEnabled();
  const microsoftOauthAvailable = isMicrosoftLoginEnabled();
  const t = await getTranslations("auth");
  const params = await searchParams;
  const redirectTo = sanitizeRedirectPath(params?.redirect ?? null);
  const initialError = params?.error ?? null;

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("createAccount")} />

        <SignupClient
          captchaSiteKey={captchaSiteKey}
          linkedinOauthAvailable={linkedinOauthAvailable}
          microsoftOauthAvailable={microsoftOauthAvailable}
          redirectTo={redirectTo}
          initialError={initialError}
        />
      </div>
    </div>
  );
}
