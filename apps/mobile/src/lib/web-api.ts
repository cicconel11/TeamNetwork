import { supabase } from "@/lib/supabase";

const WEB_API_URL = process.env.EXPO_PUBLIC_WEB_URL || "https://www.myteamnetwork.com";

export function getWebAppUrl() {
  return WEB_API_URL;
}

export async function fetchWithAuth(path: string, options: RequestInit) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Not authenticated");
  }

  const headers = {
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${accessToken}`,
  };

  return fetch(`${WEB_API_URL}${path}`, {
    ...options,
    headers,
  });
}
