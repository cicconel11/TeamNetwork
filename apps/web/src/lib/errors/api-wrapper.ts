import { NextResponse } from "next/server";
import { captureException } from "./server";

type RouteHandler = (
  request: Request,
  context?: { params: Record<string, string> }
) => Promise<Response>;

interface WrapperOptions {
  /** API path for error tracking (defaults to request URL pathname) */
  apiPath?: string;
}

/**
 * Higher-order function that wraps API route handlers to automatically
 * capture and report errors.
 *
 * @example
 * ```ts
 * export const GET = withErrorCapture(async (request) => {
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 * ```
 *
 * @example With options:
 * ```ts
 * export const POST = withErrorCapture(
 *   async (request) => {
 *     // handler logic
 *   },
 *   { apiPath: "/api/users" }
 * );
 * ```
 */
export function withErrorCapture(
  handler: RouteHandler,
  options: WrapperOptions = {}
): RouteHandler {
  return async (request: Request, context?: { params: Record<string, string> }) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const apiPath = options.apiPath || new URL(request.url).pathname;

      // Capture the error (fire-and-forget)
      captureException(error, {
        apiPath,
        severity: "high",
        meta: {
          method: request.method,
          url: request.url,
          params: context?.params,
        },
      }).catch((err) => {
        console.error("[withErrorCapture] Failed to capture error:", err);
      });

      // Re-throw to let Next.js handle the error response
      // Or return a generic error response
      console.error(`[${apiPath}] Unhandled error:`, error);

      return NextResponse.json(
        {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  };
}

/**
 * Manually capture an error within an API route.
 * Use this when you want to capture errors but continue processing.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   try {
 *     await riskyOperation();
 *   } catch (error) {
 *     await captureApiError(error, { apiPath: "/api/risky" });
 *     // Continue with fallback logic
 *   }
 * }
 * ```
 */
export async function captureApiError(
  error: unknown,
  options: {
    apiPath: string;
    userId?: string | null;
    sessionId?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  const { apiPath, userId, sessionId, meta } = options;

  await captureException(error, {
    apiPath,
    userId,
    sessionId,
    severity: "medium",
    meta,
  });
}
