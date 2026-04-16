import { createEnrichmentProcessGetHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
export const GET = createEnrichmentProcessGetHandler();
