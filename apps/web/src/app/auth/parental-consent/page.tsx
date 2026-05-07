import Link from "next/link";
import { AuthHeader } from "@/components/auth/AuthHeader";
import { Card } from "@/components/ui";

export default function ParentalConsentPage() {
  return (
    <div className="auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <AuthHeader subtitle="Parental Consent" />

        <Card className="p-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white mb-4">
              Parental Consent Required
            </h2>
            <p className="text-white/50 mb-6">
              A parent or guardian must provide consent for users under 13 to create an account.
              Please have your parent or guardian complete the signup process.
            </p>
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#22c55e] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Back to Sign Up
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
