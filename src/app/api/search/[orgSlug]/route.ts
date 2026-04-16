import { NextRequest } from "next/server";
import { handleGlobalSearchGet } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await ctx.params;
  return handleGlobalSearchGet(request, orgSlug);
}
