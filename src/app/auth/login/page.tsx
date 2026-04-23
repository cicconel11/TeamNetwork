import { AuthHeader } from "@/components/auth/AuthHeader";
import { isLinkedInLoginEnabled } from "@/lib/linkedin/config.server";
import { isMicrosoftLoginEnabled } from "@/lib/microsoft/sso-config.server";
import { getCaptchaSiteKey } from "@/lib/security/captcha";
import { LoginClient } from "./LoginClient";
import { getTranslations } from "next-intl/server";

// Force dynamic rendering so env vars are read at request time
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const captchaSiteKey = getCaptchaSiteKey();
  const linkedinOauthAvailable = isLinkedInLoginEnabled();
  const microsoftOauthAvailable = isMicrosoftLoginEnabled();

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("signInToAccount")} />

        <LoginClient
          captchaSiteKey={captchaSiteKey}
          linkedinOauthAvailable={linkedinOauthAvailable}
          microsoftOauthAvailable={microsoftOauthAvailable}
        />
      </div>
    </div>
  );
}
