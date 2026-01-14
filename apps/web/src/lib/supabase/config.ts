const expectedProjectRef = "rytsziwekhtjdqzzpdso";

function assertValue(name: string, value: string | undefined) {
  if (!value || value.trim() === "") {
    throw new Error(`Missing Supabase env: ${name}`);
  }
  // Always trim to prevent trailing whitespace/newlines from breaking API keys
  return value.trim();
}

export function getSupabaseBrowserEnv() {
  const supabaseUrl = assertValue("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = assertValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl.includes(expectedProjectRef)) {
    throw new Error(
      `Supabase URL does not match expected project ref (${expectedProjectRef}). Got: ${supabaseUrl}`
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function getSupabaseServiceEnv() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();
  const serviceRoleKey = assertValue("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { supabaseUrl, supabaseAnonKey, serviceRoleKey };
}

export function validateSiteUrl() {
  if (process.env.NODE_ENV === "production") {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) {
      console.warn("[SUPABASE CONFIG] NEXT_PUBLIC_SITE_URL is not set in production - OAuth redirects may be unreliable");
      return false;
    } else if (!siteUrl.includes("www.myteamnetwork.com")) {
      console.warn(`[SUPABASE CONFIG] NEXT_PUBLIC_SITE_URL (${siteUrl}) doesn't match expected domain`);
      return false;
    }
  }
  return true;
}
