type JsonBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

type ErrorPayload = {
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

export class ApiMutationError extends Error {
  readonly status: number;
  readonly details?: string[];
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown, details?: string[]) {
    super(message);
    this.name = "ApiMutationError";
    this.status = status;
    this.payload = payload;
    this.details = details;
  }
}

export interface RequestJsonOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | JsonBody;
  fetchImpl?: typeof fetch;
}

function isBodyInit(body: unknown): body is BodyInit {
  return typeof FormData !== "undefined" && body instanceof FormData
    || typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams
    || typeof Blob !== "undefined" && body instanceof Blob
    || typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer
    || typeof ReadableStream !== "undefined" && body instanceof ReadableStream
    || typeof body === "string";
}

function normalizeDetails(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const strings = details.filter((detail): detail is string => typeof detail === "string");
  return strings.length > 0 ? strings : undefined;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  return text || null;
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const { error, message } = payload as ErrorPayload;
    if (typeof error === "string" && error.trim()) return error;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback;
}

export async function requestJson<T = unknown>(input: RequestInfo | URL, options: RequestJsonOptions = {}): Promise<T> {
  const { body, fetchImpl = fetch, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;

  if (body !== undefined) {
    if (isBodyInit(body)) {
      requestBody = body;
    } else {
      requestHeaders.set("Content-Type", requestHeaders.get("Content-Type") || "application/json");
      requestBody = JSON.stringify(body);
    }
  }

  const response = await fetchImpl(input, {
    ...init,
    headers: requestHeaders,
    body: requestBody,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const details = payload && typeof payload === "object" ? normalizeDetails((payload as ErrorPayload).details) : undefined;
    throw new ApiMutationError(
      errorMessageFromPayload(payload, `Request failed with status ${response.status}`),
      response.status,
      payload,
      details,
    );
  }

  return payload as T;
}
