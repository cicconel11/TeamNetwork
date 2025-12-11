const expectedProjectRef = "rytsziwekhtjdqzzpdso";

function assertValue(name: string, value: string | undefined) {
  if (!value || value.trim() === "") {
    throw new Error(`Missing Supabase env: ${name}`);
  }
  return value;
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

