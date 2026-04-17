import { createAiPendingActionsCleanupHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createAiPendingActionsCleanupHandler();
