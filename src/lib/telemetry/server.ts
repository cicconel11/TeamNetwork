import { NextRequest, NextResponse } from "next/server";
import { captureException } from "@/lib/errors/server";
import type { ErrorSeverity } from "@/lib/schemas/errors";

/**
 * Context for telemetry reporting
 */
export interface TelemetryContext {
  apiPath: string;
  method: string;
  userId?: string | null;
  sessionId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Classification result for an error
 */
export interface ErrorClassification {
  severity: ErrorSeverity;
  isExternalServiceError: boolean;
  externalService?: "stripe" | "resend";
  breaksCoreFlow: boolean;
}

/**
 * Reporter instance for manual telemetry in webhooks
 */
export interface TelemetryReporter {
  reportError: (error: unknown, meta?: Record<string, unknown>) => Promise<void>;
  reportWarning: (message: string, meta?: Record<string, unknown>) => Promise<void>;
  setUserId: (userId: string | null) => void;
  getContext: () => TelemetryContext;
}

/**
 * Options for the withTelemetry HOF
 */
export interface WithTelemetryOptions {
  apiPath: string;
  /** HTTP status codes that should not be logged as errors */
  skipStatusCodes?: number[];
  /** Additional metadata to include with all telemetry */
  meta?: Record<string, unknown>;
}

// Stripe error detection patterns
const STRIPE_ERROR_NAME_PATTERNS = ["stripe", "stripeerror"];
const STRIPE_MESSAGE_PATTERNS = [
  /no such (subscription|customer|payment_intent|checkout\.session)/i,
  /stripe/i,
  /rate_limit/i,
  /card_error/i,
  /idempotency_error/i,
];

// Resend error detection patterns
const RESEND_MESSAGE_PATTERNS = [
  /resend/i,
  /email.*failed/i,
  /sender.*not.*verified/i,
];

// Core flow patterns that indicate high severity
const CORE_FLOW_PATTERNS = [
  /webhook.*signature/i,
  /signature.*verification/i,
  /payment.*creation/i,
  /checkout.*creation/i,
  /subscription.*event/i,
];

/**
 * Detect if an error originated from Stripe
 */
function isStripeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Check error name
  const nameLower = error.name.toLowerCase();
  if (STRIPE_ERROR_NAME_PATTERNS.some((p) => nameLower.includes(p))) {
    return true;
  }

  // Check message patterns
  return STRIPE_MESSAGE_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * Detect if an error originated from Resend
 */
function isResendError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Check for Resend error shape (has statusCode property)
  const hasStatusCode = "statusCode" in error;
  if (hasStatusCode && RESEND_MESSAGE_PATTERNS.some((p) => p.test(error.message))) {
    return true;
  }

  // Check message patterns
  return RESEND_MESSAGE_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * Determine if an error breaks a core flow
 */
function breaksCoreFlow(error: unknown, context: TelemetryContext): boolean {
  if (!(error instanceof Error)) return false;

  // Signature verification failures are always core
  if (CORE_FLOW_PATTERNS.some((pattern) => pattern.test(error.message))) {
    return true;
  }

  // Webhook routes have stricter severity
  if (context.apiPath.includes("/webhook")) {
    // Payment/subscription processing errors in webhooks are core
    const webhookCriticalPatterns = [
      /failed to (provision|create|update)/i,
      /processing failed/i,
    ];
    if (webhookCriticalPatterns.some((p) => p.test(error.message))) {
      return true;
    }
  }

  return false;
}

/**
 * Classify an error to determine severity and source
 */
export function classifyError(
  error: unknown,
  context: TelemetryContext
): ErrorClassification {
  const isStripe = isStripeError(error);
  const isResend = isResendError(error);
  const isCoreFlow = breaksCoreFlow(error, context);

  // Determine external service
  let externalService: "stripe" | "resend" | undefined;
  if (isStripe) externalService = "stripe";
  else if (isResend) externalService = "resend";

  // Determine severity
  let severity: ErrorSeverity;

  if (isCoreFlow) {
    severity = "high";
  } else if (isStripe || isResend) {
    // External service errors without core flow impact are low severity
    severity = "low";
  } else {
    // Internal unhandled errors are medium by default
    severity = "medium";
  }

  return {
    severity,
    isExternalServiceError: isStripe || isResend,
    externalService,
    breaksCoreFlow: isCoreFlow,
  };
}

/**
 * Create a telemetry reporter for manual use in webhooks
 */
export function createTelemetryReporter(
  initialContext: Omit<TelemetryContext, "userId" | "sessionId"> & {
    userId?: string | null;
    sessionId?: string | null;
  }
): TelemetryReporter {
  const context: TelemetryContext = {
    apiPath: initialContext.apiPath,
    method: initialContext.method,
    userId: initialContext.userId ?? null,
    sessionId: initialContext.sessionId ?? null,
    meta: initialContext.meta,
  };

  return {
    async reportError(error: unknown, meta?: Record<string, unknown>) {
      const classification = classifyError(error, context);

      await captureException(error, {
        apiPath: context.apiPath,
        userId: context.userId,
        sessionId: context.sessionId,
        severity: classification.severity,
        meta: {
          ...context.meta,
          ...meta,
          method: context.method,
          externalService: classification.externalService,
          breaksCoreFlow: classification.breaksCoreFlow,
        },
      });
    },

    async reportWarning(message: string, meta?: Record<string, unknown>) {
      // Warnings are logged as low severity errors
      await captureException(new Error(message), {
        apiPath: context.apiPath,
        userId: context.userId,
        sessionId: context.sessionId,
        severity: "low",
        meta: {
          ...context.meta,
          ...meta,
          method: context.method,
          isWarning: true,
        },
      });
    },

    setUserId(userId: string | null) {
      context.userId = userId;
    },

    getContext() {
      return { ...context };
    },
  };
}

/**
 * Report a non-2xx response from an external service as a low-severity warning
 */
export async function reportExternalServiceWarning(
  service: "stripe" | "resend",
  message: string,
  context: TelemetryContext,
  meta?: Record<string, unknown>
): Promise<void> {
  await captureException(new Error(`[${service}] ${message}`), {
    apiPath: context.apiPath,
    userId: context.userId,
    sessionId: context.sessionId,
    severity: "low",
    meta: {
      ...context.meta,
      ...meta,
      method: context.method,
      externalService: service,
      isWarning: true,
    },
  });
}

/**
 * Type for route handler with telemetry
 */
type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
  telemetry: TelemetryReporter
) => Promise<NextResponse>;

/**
 * Higher-order function wrapper for API routes with telemetry
 *
 * @example
 * ```ts
 * export const POST = withTelemetry(
 *   async (req, ctx, telemetry) => {
 *     const user = await getUser();
 *     telemetry.setUserId(user?.id ?? null);
 *     // ... route logic
 *     return NextResponse.json({ success: true });
 *   },
 *   { apiPath: "/api/example", skipStatusCodes: [400, 401, 404] }
 * );
 * ```
 */
export function withTelemetry(
  handler: RouteHandler,
  options: WithTelemetryOptions
): (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<NextResponse> {
  const { apiPath, skipStatusCodes = [], meta } = options;

  return async (req, ctx) => {
    const telemetry = createTelemetryReporter({
      apiPath,
      method: req.method,
      meta,
    });

    try {
      const response = await handler(req, ctx, telemetry);

      // Log non-2xx responses that aren't in skip list
      const status = response.status;
      if (status >= 400 && !skipStatusCodes.includes(status)) {
        // Try to extract error message from response
        let errorMessage = `HTTP ${status}`;
        try {
          const cloned = response.clone();
          const body = await cloned.json();
          if (body.error) {
            errorMessage = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
          }
        } catch {
          // Response wasn't JSON, use status code
        }

        await telemetry.reportError(new Error(errorMessage), {
          statusCode: status,
          phase: "response",
        });
      }

      return response;
    } catch (error) {
      // Unhandled exceptions get reported and re-thrown
      await telemetry.reportError(error, { phase: "unhandled_exception" });
      throw error;
    }
  };
}
