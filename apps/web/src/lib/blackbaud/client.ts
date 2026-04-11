import type { BlackbaudListResponse } from "./types";

const SKY_API_BASE = "https://api.sky.blackbaud.com";

export class BlackbaudApiError extends Error {
  status: number;
  path: string;
  body: string;
  isQuotaExhausted: boolean;
  retryAfterHuman: string | null;

  constructor(status: number, path: string, body: string) {
    super(`Blackbaud API error (${status}) on ${path}: ${body}`);
    this.status = status;
    this.path = path;
    this.body = body;

    const quotaMatch = body.match(/Out of call volume quota.*?replenished in (\d{2}:\d{2}:\d{2})/i);
    this.isQuotaExhausted = !!quotaMatch || (status === 429);
    this.retryAfterHuman = quotaMatch?.[1] ?? null;
  }
}

export interface BlackbaudClientConfig {
  accessToken: string;
  subscriptionKey: string;
  fetchFn?: typeof fetch;
}

export interface BlackbaudClient {
  get: <T = unknown>(path: string, params?: Record<string, string>) => Promise<T>;
  getList: <T>(path: string, params?: Record<string, string>) => Promise<BlackbaudListResponse<T>>;
}

export function createBlackbaudClient(config: BlackbaudClientConfig): BlackbaudClient {
  const fetchFn = config.fetchFn ?? fetch;

  async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, SKY_API_BASE);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Bb-Api-Subscription-Key": config.subscriptionKey,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new BlackbaudApiError(response.status, path, text);
      throw err;
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T = unknown>(path: string, params?: Record<string, string>) =>
      request<T>(path, params),
    getList: <T>(path: string, params?: Record<string, string>) =>
      request<BlackbaudListResponse<T>>(path, params),
  };
}
