import { AuthHeader } from "@/components/auth/AuthHeader";
import { ResetPasswordClient } from "./ResetPasswordClient";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Set your new password" />

        <ResetPasswordClient />
      </div>
    </div>
  );
}
