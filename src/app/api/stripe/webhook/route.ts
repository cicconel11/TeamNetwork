import { handleStripeWebhookPost } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleStripeWebhookPost(req);
}
