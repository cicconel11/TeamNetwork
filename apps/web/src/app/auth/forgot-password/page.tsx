import { AuthHeader } from "@/components/auth/AuthHeader";
import { ForgotPasswordClient } from "./ForgotPasswordClient";
import { getCaptchaSiteKey } from "@/lib/security/captcha";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  const captchaSiteKey = getCaptchaSiteKey();

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("resetPassword")} />

        <ForgotPasswordClient captchaSiteKey={captchaSiteKey} />
      </div>
    </div>
  );
}
