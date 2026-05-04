import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, type ApiError } from "./response";

type MaybePromise<T> = T | Promise<T>;
type AnySchema = z.ZodType;

type InferSchema<TSchema> = TSchema extends z.ZodType ? z.infer<TSchema> : undefined;

export type ApiAuthResult<TAuth> =
  | { ok: true; user?: unknown; context?: unknown; value?: TAuth }
  | { ok: false; status?: number; message?: string; code?: "UNAUTHORIZED" | "FORBIDDEN" };

export type ApiRouteContext<TBody, TQuery, TParams, TAuth> = {
  request: Request;
  body: TBody;
  query: TQuery;
  params: TParams;
  auth: TAuth;
};

export type ApiRouteOptions<
  TBodySchema extends AnySchema | undefined,
  TQuerySchema extends AnySchema | undefined,
  TParamsSchema extends AnySchema | undefined,
  TAuth,
> = {
  body?: TBodySchema;
  query?: TQuerySchema;
  params?: TParamsSchema;
  headers?: HeadersInit;
  before?: (request: Request) => MaybePromise<Response | void>;
  auth?: (request: Request) => MaybePromise<ApiAuthResult<TAuth>>;
  onValidationError?: (context: {
    request: Request;
    source: "body" | "query" | "params";
    response: Response;
  }) => MaybePromise<void>;
  handler: (
    context: ApiRouteContext<
      InferSchema<TBodySchema>,
      InferSchema<TQuerySchema>,
      InferSchema<TParamsSchema>,
      TAuth
    >,
  ) => MaybePromise<Response>;
};

export function createApiRoute<
  TBodySchema extends AnySchema | undefined = undefined,
  TQuerySchema extends AnySchema | undefined = undefined,
  TParamsSchema extends AnySchema | undefined = undefined,
  TAuth = undefined,
>(options: ApiRouteOptions<TBodySchema, TQuerySchema, TParamsSchema, TAuth>) {
  return async (request: Request, routeContext?: { params?: unknown }) => {
    try {
      const earlyResponse = await options.before?.(request);
      if (earlyResponse) return withDefaultHeaders(earlyResponse, options.headers);

      const body = options.body
        ? await parseJsonBody(request, options.body)
        : undefined;
      if (body instanceof Response) return handleValidationError(options, request, "body", body);

      const query = options.query
        ? parseWithSchema(options.query, parseSearchParams(new URL(request.url).searchParams), "Invalid query parameters")
        : undefined;
      if (query instanceof Response) return handleValidationError(options, request, "query", query);

      const rawParams = routeContext?.params && typeof routeContext.params === "object" && "then" in routeContext.params
        ? await routeContext.params
        : routeContext?.params;
      const params = options.params
        ? parseWithSchema(options.params, rawParams ?? {}, "Invalid route parameters")
        : undefined;
      if (params instanceof Response) return handleValidationError(options, request, "params", params);

      const auth: ApiAuthResult<TAuth> = options.auth
        ? await options.auth(request)
        : { ok: true, value: undefined as TAuth };
      if (!auth.ok) {
        return withDefaultHeaders(
          errorResponse(
            auth.code ?? (auth.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED"),
            auth.message ?? (auth.status === 403 ? "Access denied." : "You must be logged in."),
            auth.status ?? (auth.code === "FORBIDDEN" ? 403 : 401),
          ),
          options.headers,
        );
      }

      const authValue = "value" in auth ? auth.value : (auth as TAuth);
      const response = await options.handler({
        request,
        body: body as InferSchema<TBodySchema>,
        query: query as InferSchema<TQuerySchema>,
        params: params as InferSchema<TParamsSchema>,
        auth: authValue as TAuth,
      });

      return withDefaultHeaders(response, options.headers);
    } catch (error) {
      console.error("[api-route] Unhandled route error:", error);
      return withDefaultHeaders(errorResponse("INTERNAL_ERROR", "An unexpected error occurred.", 500), options.headers);
    }
  };
}

export function parseSearchParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

async function parseJsonBody(schema: AnySchema, request: Request): Promise<unknown | Response>;
async function parseJsonBody(request: Request, schema: AnySchema): Promise<unknown | Response>;
async function parseJsonBody(arg1: Request | AnySchema, arg2: Request | AnySchema): Promise<unknown | Response> {
  const request = arg1 instanceof Request ? arg1 : arg2 as Request;
  const schema = arg1 instanceof Request ? arg2 as AnySchema : arg1 as AnySchema;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", "Invalid request body", 400);
  }
  return parseWithSchema(schema, json, "Invalid request body");
}

function parseWithSchema(schema: AnySchema, value: unknown, message: string): unknown | NextResponse<ApiError> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  return errorResponse(
    "VALIDATION_ERROR",
    message,
    400,
    parsed.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`),
  );
}

async function handleValidationError<
  TBodySchema extends AnySchema | undefined,
  TQuerySchema extends AnySchema | undefined,
  TParamsSchema extends AnySchema | undefined,
  TAuth,
>(
  options: ApiRouteOptions<TBodySchema, TQuerySchema, TParamsSchema, TAuth>,
  request: Request,
  source: "body" | "query" | "params",
  response: Response,
): Promise<Response> {
  await options.onValidationError?.({ request, source, response });
  return withDefaultHeaders(response, options.headers);
}

function withDefaultHeaders(response: Response, headers?: HeadersInit): Response {
  if (!headers) return response;
  const merged = new Headers(response.headers);
  new Headers(headers).forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
