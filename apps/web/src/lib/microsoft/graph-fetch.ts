/**
 * Thin fetch wrapper for Microsoft Graph API calls.
 * Handles 401 (token refresh signal), 404, 429 (rate limiting), and generic errors.
 */

export class GraphNotFoundError extends Error {
    constructor(path: string) {
        super(`404: Not Found — ${path}`);
        this.name = "GraphNotFoundError";
    }
}

export class GraphUnauthorizedError extends Error {
    constructor() {
        super("401: Unauthorized — access token may be expired");
        this.name = "GraphUnauthorizedError";
    }
}

export class GraphApiError extends Error {
    constructor(status: number, message: string) {
        super(`${status}: ${message}`);
        this.name = "GraphApiError";
    }
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphFetchRetryOptions {
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
}

export async function graphFetch(
    path: string,
    accessToken: string,
    options: RequestInit = {},
    retryOptions: GraphFetchRetryOptions = {}
): Promise<Response> {
    const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;

    const maxRetries = retryOptions.maxRetries ?? 2;
    const sleep = retryOptions.sleep ?? defaultSleep;

    for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });

        if (response.status === 401) {
            throw new GraphUnauthorizedError();
        }

        if (response.status === 404) {
            throw new GraphNotFoundError(path);
        }

        if (response.status === 429) {
            if (attempt >= maxRetries) {
                throw new GraphApiError(429, "Microsoft Graph rate limit exceeded after retries");
            }

            const retryAfter = response.headers.get("Retry-After");
            const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 10;
            await sleep(waitSeconds * 1000);
            continue;
        }

        if (!response.ok) {
            const body = await response.text().catch(() => response.statusText);
            throw new GraphApiError(response.status, body);
        }

        return response;
    }
}

async function defaultSleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
