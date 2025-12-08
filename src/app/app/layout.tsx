import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Protect all /app routes - must be logged in
  if (!user) {
    redirect("/auth/login");
  }

  return <>{children}</>;
}


