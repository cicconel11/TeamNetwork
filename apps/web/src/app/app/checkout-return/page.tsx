import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Checkout — TeamNetwork",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  org?: string;
  status?: string;
  source?: string;
}>;

function CheckoutReturnView({
  status,
  org,
  source,
}: {
  status: "success" | "cancel" | "unknown";
  org: string | null;
  source: string | null;
}) {
  const isMobile = source === "mobile";
  const headline =
    status === "success"
      ? "Payment confirmed"
      : status === "cancel"
        ? "Checkout cancelled"
        : "All set";
  const body =
    status === "success"
      ? isMobile
        ? "Your organization is being set up. Return to the TeamNetwork app and pull to refresh — it should appear in a few seconds."
        : "Your organization is being set up. Head back to your dashboard to manage it."
      : status === "cancel"
        ? isMobile
          ? "No payment was taken. You can try again from the TeamNetwork app."
          : "No payment was taken. You can try again from your dashboard."
        : isMobile
          ? "You can return to the TeamNetwork app to continue."
          : "You can return to your dashboard to continue.";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/TeamNetwor.png"
              alt=""
              width={541}
              height={303}
              className="h-7 w-auto object-contain"
              aria-hidden="true"
            />
            <span className="text-2xl font-bold text-foreground">
              <span className="text-green-500">Team</span>Network
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center space-y-6">
          <div
            className={`mx-auto h-16 w-16 rounded-full flex items-center justify-center ${
              status === "success"
                ? "bg-green-100 text-green-600"
                : status === "cancel"
                  ? "bg-amber-100 text-amber-600"
                  : "bg-muted text-muted-foreground"
            }`}
            aria-hidden="true"
          >
            {status === "success" ? (
              <svg
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            ) : (
              <svg
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">{headline}</h1>
            <p className="text-muted-foreground">{body}</p>
            {org && (
              <p className="text-sm text-muted-foreground">
                Organization:{" "}
                <span className="font-medium text-foreground">{org}</span>
              </p>
            )}
          </div>

          {!isMobile && (
            <div className="pt-2">
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-xl bg-foreground text-background px-5 py-3 font-medium hover:opacity-90"
              >
                Go to dashboard
              </Link>
            </div>
          )}

          {isMobile && (
            <p className="text-xs text-muted-foreground pt-4">
              You can safely close this tab.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawStatus = params.status;
  const status: "success" | "cancel" | "unknown" =
    rawStatus === "success"
      ? "success"
      : rawStatus === "cancel"
        ? "cancel"
        : "unknown";
  const org = typeof params.org === "string" ? params.org : null;
  const source = typeof params.source === "string" ? params.source : null;

  return (
    <Suspense fallback={null}>
      <CheckoutReturnView status={status} org={org} source={source} />
    </Suspense>
  );
}
