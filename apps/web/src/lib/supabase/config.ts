const expectedProjectRef = "rytsziwekhtjdqzzpdso";
const canonicalProductionHost = "www.myteamnetwork.com";

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

function isVercelProductionRuntime(env: NodeJS.ProcessEnv) {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}

function parseSiteUrl(siteUrl: string): { host: string; protocol: string } | null {
  try {
    const parsed = new URL(siteUrl);
    return { host: parsed.host, protocol: parsed.protocol };
  } catch {
    return null;
  }
}

export function validateSiteUrl(env: NodeJS.ProcessEnv = process.env) {
  if (!isVercelProductionRuntime(env)) {
    return true;
  }

  const siteUrl = env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("[SUPABASE CONFIG] NEXT_PUBLIC_SITE_URL is not set for Vercel production — OAuth redirects will fail");
  }

  const parsedSiteUrl = parseSiteUrl(siteUrl);
  if (!parsedSiteUrl || parsedSiteUrl.host !== canonicalProductionHost || parsedSiteUrl.protocol !== "https:") {
    throw new Error(
      `[SUPABASE CONFIG] NEXT_PUBLIC_SITE_URL (${siteUrl}) must use the canonical production origin (https://${canonicalProductionHost})`
    );
  }

  return true;
}
