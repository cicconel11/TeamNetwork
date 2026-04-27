/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared harness primitives for the eval runner + trust-boundary self-test.
 * Loads cases, builds requests, sets eval-only env, dynamic-imports the chat
 * handler.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalCase, EvalCaseInput } from "./types.ts";
import { ORG_ID, VALID_IDEMPOTENCY_KEY } from "./fixtures/supabase-stub.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CASES_DIR = resolve(HERE, "cases");

export function loadCases(): EvalCase[] {
  const out: EvalCase[] = [];
  for (const file of readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"))) {
    const parsed = JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"));
    out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return out;
}

export interface BuildRequestOptions {
  /** Force orgId in URL. Defaults to authContext.orgId or ORG_ID. */
  orgId?: string;
}

export function buildChatRequest(
  input: EvalCaseInput,
  opts: BuildRequestOptions = {}
): Request {
  const orgId =
    opts.orgId ??
    (input.authContext?.ok && input.authContext.orgId ? input.authContext.orgId : ORG_ID);
  return new Request(`http://localhost/api/ai/${orgId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      surface: input.surface ?? "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
      ...(input.currentPath ? { currentPath: input.currentPath } : {}),
    }),
  });
}

export function setupEvalEnv(): void {
  process.env.ZAI_API_KEY ??= "test-key";
  process.env.DISABLE_AI_CACHE = "true";
  delete process.env.EMBEDDING_API_KEY;
}

export async function loadChatHandlerFactory() {
  const mod = await import("../../src/app/api/ai/[orgId]/chat/handler.ts");
  return mod.createChatPostHandler;
}
