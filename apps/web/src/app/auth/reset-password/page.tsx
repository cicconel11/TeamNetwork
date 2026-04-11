import { AuthHeader } from "@/components/auth/AuthHeader";
import { ResetPasswordClient } from "./ResetPasswordClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const t = await getTranslations("auth");

  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle={t("resetPassword")} />

        <ResetPasswordClient />
      </div>
    </div>
  );
}
