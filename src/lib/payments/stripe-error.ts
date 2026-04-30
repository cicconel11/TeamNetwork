import { NextResponse } from "next/server";
import { IdempotencyConflictError } from "@/lib/payments/idempotency";

type ErrLike = {
  type?: string;
  name?: string;
  code?: string;
  message?: string;
  statusCode?: number;
  requestId?: string;
  raw?: { code?: string; message?: string; requestId?: string; statusCode?: number; type?: string };
};

type StripeErrorClass = "stripe" | "idempotency" | "internal";

export function classifyCheckoutError(error: unknown): StripeErrorClass {
  if (error instanceof IdempotencyConflictError) return "idempotency";
  const e = error as ErrLike;
  const type = e?.type || e?.name || e?.raw?.type || "";
  if (typeof type === "string" && type.startsWith("Stripe")) return "stripe";
  if (typeof e?.raw?.type === "string" && e.raw.type.endsWith("_error")) return "stripe";
  // requestId is Stripe-specific (req_*); statusCode alone is not — many
  // non-Stripe errors carry a statusCode and should fall through to "internal".
  if (e?.requestId || e?.raw?.requestId) return "stripe";
  return "internal";
}

export function extractErrorMessage(error: unknown): string {
  const e = error as ErrLike;
  return e?.message || e?.raw?.message || "checkout_failed";
}

function isVerboseDev() {
  if (process.env.NODE_ENV === "production") {
    return process.env.STRIPE_VERBOSE_ERRORS === "true";
  }
  return true;
}

type CheckoutErrorBody = {
  error: string;
  detail?: string;
  errorClass?: StripeErrorClass;
};

export function buildCheckoutErrorResponse(
  error: unknown,
  init: { headers?: HeadersInit } = {},
): NextResponse {
  const cls = classifyCheckoutError(error);
  const detail = extractErrorMessage(error);
  const verbose = isVerboseDev();

  if (cls === "idempotency") {
    return NextResponse.json(
      { error: detail, errorClass: cls },
      { status: 409, headers: init.headers },
    );
  }

  if (cls === "stripe") {
    const body: CheckoutErrorBody = {
      error: "Payment provider rejected the request",
    };
    if (verbose) {
      body.detail = detail;
      body.errorClass = cls;
    }
    return NextResponse.json(body, { status: 502, headers: init.headers });
  }

  const body: CheckoutErrorBody = {
    error: "Unable to start checkout",
  };
  if (verbose) {
    body.detail = detail;
    body.errorClass = cls;
  }
  return NextResponse.json(body, { status: 500, headers: init.headers });
}
