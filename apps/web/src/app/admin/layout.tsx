import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDevAdminEmail } from "@/lib/auth/dev-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isDevAdminEmail(user.email)) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8 max-w-7xl mx-auto px-4">
        {children}
      </div>
    </div>
  );
}
