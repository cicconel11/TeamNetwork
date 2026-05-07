import { NextResponse } from "next/server";
import { isBlackbaudConfigured } from "@/lib/blackbaud/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: isBlackbaudConfigured() });
}
