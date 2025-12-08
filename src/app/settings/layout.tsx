import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui";

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export default async function SettingsLayout({ children }: SettingsLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/app">
              <h1 className="text-2xl font-bold text-foreground">
                Team<span className="text-emerald-500">Network</span>
              </h1>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-foreground font-medium">Settings</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/app">
              <Button variant="ghost" size="sm">
                Back to Organizations
              </Button>
            </Link>
            <form action="/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit">
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}


