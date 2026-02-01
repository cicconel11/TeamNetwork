import Link from "next/link";
import { Card } from "@/components/ui";

export default function ParentalConsentPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
        </div>

        <Card className="p-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Parental Consent Required
            </h2>
            <p className="text-muted-foreground mb-6">
              A parent or guardian must provide consent for users under 13 to create an account.
              Please have your parent or guardian complete the signup process.
            </p>
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              Back to Sign Up
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
