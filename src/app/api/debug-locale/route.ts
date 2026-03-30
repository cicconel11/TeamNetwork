import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLocale, getMessages } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  const allCookieNames = cookieStore.getAll().map((c) => `${c.name}=${c.value?.slice(0, 20)}`);

  let locale = "error";
  let messageKeys: string[] = [];
  try {
    locale = await getLocale();
    const msgs = await getMessages();
    messageKeys = Object.keys(msgs as Record<string, unknown>);
  } catch (e) {
    locale = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json({
    cookie_NEXT_LOCALE: raw ?? null,
    resolved_locale: locale,
    message_namespaces: messageKeys,
    all_cookies: allCookieNames,
    timestamp: new Date().toISOString(),
  });
}
