import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function decodeJwt(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    return { iss: payload.iss, aud: payload.aud, sub: payload.sub };
  } catch {
    return null;
  }
}

export default async function AuthDebugPage() {
  const allowInProd = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
  if (process.env.NODE_ENV === "production" && !allowInProd) {
    return notFound();
  }

  const cookieStore = await cookies();
  const sbCookies = cookieStore.getAll().filter((c) => c.name.startsWith("sb-"));
  const supabase = await createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  const firstToken = sbCookies.find((c) => c.name.includes("auth-token"));
  const decoded = firstToken?.value ? decodeJwt(firstToken.value) : null;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4 text-sm">
      <h1 className="text-xl font-semibold">Auth Debug</h1>
      <div className="space-y-2">
        <h2 className="font-medium">Cookies (names only)</h2>
        <pre className="bg-muted p-3 rounded-lg">{JSON.stringify(sbCookies.map((c) => c.name), null, 2)}</pre>
      </div>
      <div className="space-y-2">
        <h2 className="font-medium">Session</h2>
        <pre className="bg-muted p-3 rounded-lg">
          {JSON.stringify(
            {
              user: session?.user
                ? { id: session.user.id, email: session.user.email }
                : null,
              error: error?.message || null,
            },
            null,
            2
          )}
        </pre>
      </div>
      <div className="space-y-2">
        <h2 className="font-medium">JWT (iss/aud)</h2>
        <pre className="bg-muted p-3 rounded-lg">
          {decoded ? JSON.stringify(decoded, null, 2) : "No token decoded"}
        </pre>
      </div>
    </div>
  );
}

