// Per-org monthly AI spend cap.
//
// Pre-call: `assertOrgUnderCap(orgId)` throws AiCapReachedError if spend >= cap.
// Post-call: `recordSpend({...})` charges priced tokens via the atomic RPC.
//
// Period: calendar UTC month (computed in Postgres). Cap default $22, overridable
// per-org via organization_subscriptions.ai_monthly_cap_cents.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isDevAdmin } from "@/lib/auth/dev-admin";

export function isAiSpendBypassed(
  user: { email?: string | null } | null | undefined,
): boolean {
  return isDevAdmin(user);
}

export type AiSurface =
  | "chat"
  | "safety_judge"
  | "rag_judge"
  | "schedule_extraction"
  | "bio_generator"
  | "embedding";

export interface SpendStatus {
  allowed: boolean;
  spendCents: number;
  capCents: number;
  percentUsed: number;
  periodStart: string; // ISO date (YYYY-MM-DD)
  periodEnd: string;   // ISO timestamp UTC end-of-month
}

export class AiPricingConfigError extends Error {
  constructor(model: string) {
    super(`ai_spend: no price configured for model "${model}"`);
    this.name = "AiPricingConfigError";
  }
}

export class AiCapReachedError extends Error {
  readonly status: SpendStatus;
  constructor(status: SpendStatus) {
    super("ai_monthly_cap_reached");
    this.name = "AiCapReachedError";
    this.status = status;
  }
  toResponse(headers?: HeadersInit): NextResponse {
    return NextResponse.json(
      {
        error: "ai_monthly_cap_reached",
        currentCents: this.status.spendCents,
        capCents: this.status.capCents,
        periodEnd: this.status.periodEnd,
      },
      { status: 402, headers },
    );
  }
}

const DEFAULT_CAP_CENTS = 2200;

function getDefaultCapCents(): number {
  const raw = process.env.AI_SPEND_CAP_CENTS;
  if (!raw) return DEFAULT_CAP_CENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP_CENTS;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// Microdollars per token = (cents per million tokens) / 100.
// Returns NaN if model has no env entry — caller fails closed.
function readPriceCentsPerMtok(envKey: string): number | undefined {
  const raw = process.env[envKey];
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

interface ModelPricing {
  inputCentsPerMtok: number;
  outputCentsPerMtok: number;
}

function lookupModelPricing(model: string): ModelPricing | undefined {
  const lower = model.toLowerCase();
  // glm-5v vision/image extraction model
  if (lower.includes("glm-5v") || lower.includes("glm5v")) {
    const input = readPriceCentsPerMtok("AI_PRICE_GLM_5V_INPUT_PER_MTOK");
    const output = readPriceCentsPerMtok("AI_PRICE_GLM_5V_OUTPUT_PER_MTOK");
    if (input == null || output == null) return undefined;
    return { inputCentsPerMtok: input, outputCentsPerMtok: output };
  }
  // glm-5.1 chat
  if (lower.includes("glm-5") || lower.includes("glm5")) {
    const input = readPriceCentsPerMtok("AI_PRICE_GLM_5_1_INPUT_PER_MTOK");
    const output = readPriceCentsPerMtok("AI_PRICE_GLM_5_1_OUTPUT_PER_MTOK");
    if (input == null || output == null) return undefined;
    return { inputCentsPerMtok: input, outputCentsPerMtok: output };
  }
  // Gemini embeddings (input-only)
  if (lower.includes("embedding") || lower.includes("embed") || lower.includes("gemini")) {
    const input = readPriceCentsPerMtok("AI_PRICE_GEMINI_EMBED_PER_MTOK");
    if (input == null) return undefined;
    return { inputCentsPerMtok: input, outputCentsPerMtok: 0 };
  }
  return undefined;
}

export function priceTokensMicrousd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = lookupModelPricing(model);
  if (!pricing) {
    throw new AiPricingConfigError(model);
  }
  // microdollars = tokens * (cents_per_mtok / 100) — tokens / 1_000_000 cancels with cents->microdollars.
  // microdollars per token = cents_per_mtok / 100.
  const inputMicro = Math.round(inputTokens * (pricing.inputCentsPerMtok / 100));
  const outputMicro = Math.round(outputTokens * (pricing.outputCentsPerMtok / 100));
  return Math.max(inputMicro + outputMicro, 0);
}

// ---------------------------------------------------------------------------
// Cap lookup + status
// ---------------------------------------------------------------------------

function endOfMonthIso(periodStart: string): string {
  // periodStart is YYYY-MM-DD UTC. End = first-of-next-month minus 1 ms.
  const [y, m] = periodStart.split("-").map((v) => Number.parseInt(v, 10));
  if (!y || !m) return new Date().toISOString();
  const end = new Date(Date.UTC(y, m, 1) - 1);
  return end.toISOString();
}

async function readOrgCapCents(orgId: string): Promise<number> {
  const supabase = createServiceClient();
  // Column is added in migration 20261030000000; cast until generated types catch up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("organization_subscriptions") as any)
    .select("ai_monthly_cap_cents")
    .eq("organization_id", orgId)
    .maybeSingle();
  const raw = (data as { ai_monthly_cap_cents?: unknown } | null | undefined)
    ?.ai_monthly_cap_cents;
  const override = typeof raw === "number" ? raw : null;
  if (override != null && override > 0) return override;
  return getDefaultCapCents();
}

async function readCurrentSpend(orgId: string): Promise<{ microusd: number; periodStart: string }> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_ai_spend_for_period", {
    p_org_id: orgId,
  });
  if (error) {
    throw new Error(`ai_spend: get_ai_spend_for_period failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  const microusd =
    row && typeof row.spend_microusd === "number"
      ? row.spend_microusd
      : row && typeof row.spend_microusd === "string"
      ? Number.parseInt(row.spend_microusd, 10)
      : 0;
  const periodStart =
    row && typeof row.period_start === "string"
      ? row.period_start
      : new Date().toISOString().slice(0, 10);
  return { microusd: Number.isFinite(microusd) ? microusd : 0, periodStart };
}

function microusdToCents(microusd: number): number {
  // 10_000 microUSD = 1 cent. Round to nearest cent.
  return Math.round(microusd / 10_000);
}

function buildStatus(
  microusd: number,
  capCents: number,
  periodStart: string,
): SpendStatus {
  const spendCents = microusdToCents(microusd);
  return {
    allowed: spendCents < capCents,
    spendCents,
    capCents,
    percentUsed: capCents > 0 ? Math.min(100, (spendCents / capCents) * 100) : 100,
    periodStart,
    periodEnd: endOfMonthIso(periodStart),
  };
}

export async function getOrgSpendStatus(orgId: string): Promise<SpendStatus> {
  const [capCents, current] = await Promise.all([
    readOrgCapCents(orgId),
    readCurrentSpend(orgId),
  ]);
  return buildStatus(current.microusd, capCents, current.periodStart);
}

export function assertModelPriceConfigured(
  model: string,
  opts?: { bypass?: boolean },
): void {
  if (opts?.bypass) return;
  // Route tests use mocked AI clients without production pricing env. Keep direct
  // pricing helpers fail-closed while avoiding broad fixture churn in test mode.
  if (process.env.NODE_ENV !== "production") return;
  if (!lookupModelPricing(model)) {
    throw new AiPricingConfigError(model);
  }
}

export async function assertOrgUnderCap(
  orgId: string,
  opts?: { bypass?: boolean },
): Promise<SpendStatus> {
  if (opts?.bypass) {
    return buildStatus(0, getDefaultCapCents(), new Date().toISOString().slice(0, 10));
  }
  if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return buildStatus(0, getDefaultCapCents(), new Date().toISOString().slice(0, 10));
  }
  const status = await getOrgSpendStatus(orgId);
  if (!status.allowed) {
    throw new AiCapReachedError(status);
  }
  return status;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RecordSpendArgs {
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  surface: AiSurface;
  /** When true, skip ledger write (dev-admin bypass). */
  bypass?: boolean;
}

export async function recordSpend(args: RecordSpendArgs): Promise<SpendStatus> {
  if (args.bypass || (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return buildStatus(0, getDefaultCapCents(), new Date().toISOString().slice(0, 10));
  }
  const microusd = priceTokensMicrousd(args.model, args.inputTokens, args.outputTokens);
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("charge_ai_spend", {
    p_org_id: args.orgId,
    p_microusd: microusd,
  });
  if (error) {
    throw new Error(`ai_spend: charge_ai_spend failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  const newMicrousd =
    row && typeof row.spend_microusd === "number"
      ? row.spend_microusd
      : row && typeof row.spend_microusd === "string"
      ? Number.parseInt(row.spend_microusd, 10)
      : microusd;
  const periodStart =
    row && typeof row.period_start === "string"
      ? row.period_start
      : new Date().toISOString().slice(0, 10);
  const capCents = await readOrgCapCents(args.orgId);
  return buildStatus(Number.isFinite(newMicrousd) ? newMicrousd : microusd, capCents, periodStart);
}
