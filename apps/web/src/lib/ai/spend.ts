// Per-org monthly AI spend cap.
//
// One preflight read (`checkAiSpend`) gates surfaces by throwing
// `AiCapReachedError` (HTTP 402). One post-call charge (`chargeAiSpend`)
// atomically increments the ledger via the `charge_and_check_ai_spend` RPC.
// Pricing is fail-open: unknown models log once and price at 0.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isDevAdmin } from "@/lib/auth/dev-admin";

export function isAiSpendBypassed(
  user: { email?: string | null } | null | undefined,
): boolean {
  return isDevAdmin(user);
}

export interface SpendStatus {
  allowed: boolean;
  spendCents: number;
  capCents: number;
  periodEnd: string; // ISO timestamp UTC end-of-month
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

// Defaults match production. Override entirely via AI_PRICES_JSON.
// Keys matched case-insensitively by substring against model name.
interface ModelPrice {
  in: number;  // cents per million input tokens
  out: number; // cents per million output tokens
}
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "glm-5v": { in: 2000, out: 6000 },
  "glm-5": { in: 600, out: 2200 },
  "embed": { in: 150, out: 0 },
  "gemini": { in: 150, out: 0 },
};

let cachedPrices: Record<string, ModelPrice> | null = null;
let cachedPricesEnv: string | undefined;
let cachedPricesKeys: string[] = [];
const warnedUnknownModels = new Set<string>();
let warnedParseFailureFor: string | undefined;

function loadPrices(): Record<string, ModelPrice> {
  const envRaw = process.env.AI_PRICES_JSON;
  if (cachedPrices && cachedPricesEnv === envRaw) return cachedPrices;
  cachedPricesEnv = envRaw;
  if (!envRaw) {
    cachedPrices = DEFAULT_PRICES;
  } else {
    try {
      cachedPrices = JSON.parse(envRaw) as Record<string, ModelPrice>;
    } catch {
      if (warnedParseFailureFor !== envRaw) {
        warnedParseFailureFor = envRaw;
        console.warn("[ai_spend] AI_PRICES_JSON parse failed, using defaults");
      }
      cachedPrices = DEFAULT_PRICES;
    }
  }
  // Match longest key first so "glm-5v" wins over "glm-5" for vision models.
  cachedPricesKeys = Object.keys(cachedPrices).sort((a, b) => b.length - a.length);
  return cachedPrices;
}

function priceCents(model: string, inputTokens: number, outputTokens: number): number {
  const prices = loadPrices();
  const lower = model.toLowerCase();
  let match: ModelPrice | undefined;
  for (const key of cachedPricesKeys) {
    if (lower.includes(key.toLowerCase())) {
      match = prices[key];
      break;
    }
  }
  if (!match) {
    if (!warnedUnknownModels.has(lower)) {
      warnedUnknownModels.add(lower);
      console.warn(`[ai_spend] unknown model "${model}", pricing at 0`);
    }
    return 0;
  }
  // tokens * cents_per_mtok / 1_000_000, rounded.
  const cents = (inputTokens * match.in + outputTokens * match.out) / 1_000_000;
  return Math.max(Math.round(cents), 0);
}

function getDefaultCapCents(): number {
  const raw = process.env.AI_SPEND_CAP_CENTS;
  if (!raw) return DEFAULT_CAP_CENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP_CENTS;
}

function endOfMonthIso(now: Date = new Date()): string {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);
  return end.toISOString();
}

function bypassStatus(): SpendStatus {
  return {
    allowed: true,
    spendCents: 0,
    capCents: getDefaultCapCents(),
    periodEnd: endOfMonthIso(),
  };
}

function isTestSkip(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

interface RpcRow {
  allowed: boolean;
  spend_cents: number;
  cap_cents: number;
  period_end: string;
}

async function callRpc(orgId: string, cents: number): Promise<SpendStatus> {
  const supabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("charge_and_check_ai_spend", {
    p_org_id: orgId,
    p_cents: cents,
  });
  if (error) {
    throw new Error(`ai_spend: charge_and_check_ai_spend failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
  if (!row) {
    throw new Error("ai_spend: charge_and_check_ai_spend returned no row");
  }
  return {
    allowed: row.allowed,
    spendCents: row.spend_cents,
    capCents: row.cap_cents,
    periodEnd: row.period_end,
  };
}

export async function checkAiSpend(
  orgId: string,
  opts?: { bypass?: boolean },
): Promise<SpendStatus> {
  if (opts?.bypass) return bypassStatus();
  if (isTestSkip()) return bypassStatus();
  const status = await callRpc(orgId, 0);
  if (!status.allowed) throw new AiCapReachedError(status);
  return status;
}

export async function getOrgSpendStatus(orgId: string): Promise<SpendStatus> {
  if (isTestSkip()) return bypassStatus();
  return callRpc(orgId, 0);
}

export interface ChargeAiSpendArgs {
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  bypass?: boolean;
}

export async function chargeAiSpend(args: ChargeAiSpendArgs): Promise<void> {
  if (args.bypass || isTestSkip()) return;
  const cents = priceCents(args.model, args.inputTokens, args.outputTokens);
  if (cents <= 0) return;
  await callRpc(args.orgId, cents);
}

// Test-only exports (do not import from product code).
export const __test = { priceCents, loadPrices };
