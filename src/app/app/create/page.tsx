import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button, Card } from "@/components/ui";

export default async function CreatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/app">
            <h1 className="text-2xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </h1>
          </Link>
          <form action="/auth/signout" method="POST">
            <Button variant="ghost" size="sm" type="submit">
              Sign Out
            </Button>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-foreground mb-3">Create your account</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Choose how you want to get started with TeamNetwork. You can always upgrade or add organizations later.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Individual Organization Option */}
          <Link href="/app/create-org" className="block">
            <Card interactive className="h-full p-6 hover:border-emerald-500 transition-colors">
              <div className="flex flex-col h-full">
                <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
                  <svg className="h-7 w-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Individual Organization</h3>
                <p className="text-muted-foreground text-sm mb-4 flex-grow">
                  Create a single organization for your team, club, or group. Perfect for teams that operate independently with their own billing.
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 mb-6">
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Simple setup in minutes
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Manage members and alumni
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Pay-as-you-grow pricing
                  </li>
                </ul>
                <div className="flex items-center text-emerald-600 font-medium text-sm">
                  Get started
                  <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </Card>
          </Link>

          {/* Enterprise Option */}
          <Link href="/app/create-enterprise" className="block">
            <Card interactive className="h-full p-6 hover:border-purple-500 transition-colors">
              <div className="flex flex-col h-full">
                <div className="h-14 w-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4">
                  <svg className="h-7 w-7 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Enterprise</h3>
                <p className="text-muted-foreground text-sm mb-4 flex-grow">
                  Manage multiple organizations under one account. Ideal for athletic departments, universities, or organizations with multiple teams.
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 mb-6">
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Pooled alumni quotas
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Unified billing across orgs
                  </li>
                  <li className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Centralized admin dashboard
                  </li>
                </ul>
                <div className="flex items-center text-purple-600 font-medium text-sm">
                  Create enterprise
                  <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </Card>
          </Link>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Not sure which to choose?{" "}
            <span className="text-foreground">
              Start with an individual organization - you can always migrate to enterprise later.
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}
