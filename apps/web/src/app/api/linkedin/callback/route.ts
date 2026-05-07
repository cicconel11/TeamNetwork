import { handleLinkedInOAuthCallback } from "@/lib/linkedin/callback";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleLinkedInOAuthCallback(request, "/settings/connected-accounts");
}
