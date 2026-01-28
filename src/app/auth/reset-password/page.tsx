import Link from "next/link";
import { ResetPasswordClient } from "./ResetPasswordClient";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
          <p className="text-muted-foreground mt-2">Set your new password</p>
        </div>

        <ResetPasswordClient />
      </div>
    </div>
  );
}
