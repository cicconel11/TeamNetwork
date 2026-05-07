/**
 * APNs HTTP/2 client with token-based auth.
 *
 * Apple requires a JWT signed with ES256 over the `.p8` private key for the
 * APNs auth key. Tokens are reusable for up to 1 hour; we cache them in
 * the client instance.
 *
 * Implementation notes:
 *   - We use the global `fetch` available in Node 18+, Vercel Node, and
 *     Supabase Edge runtime. `fetch` will negotiate HTTP/2 against
 *     `api.push.apple.com` automatically.
 *   - `jose` (not `jsonwebtoken`) so the same client compiles on the edge.
 *   - Configurable host so callers can target sandbox during development.
 */

import { SignJWT, importPKCS8 } from "jose";

const APNS_PROD_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
const TOKEN_LIFETIME_MS = 50 * 60 * 1000; // refresh ~10m before Apple's 1h cap.

export type ApnsPushType =
  | "alert"
  | "background"
  | "liveactivity"
  | "wallet";

export type ApnsPriority = 1 | 5 | 10;

export interface ApnsClientConfig {
  /** APNs auth key id (Apple Developer → Keys). */
  keyId: string;
  /** Apple Developer team id. */
  teamId: string;
  /**
   * The `.p8` auth key contents — the full PEM string, e.g.
   * `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`.
   * If you have it base64-encoded in env, decode before constructing.
   */
  privateKeyPem: string;
  /** Override host (defaults to production). */
  host?: string;
  /** When true, use Apple's sandbox host. Ignored if `host` is set. */
  sandbox?: boolean;
}

export interface SendApnsArgs {
  /** APNs device token (hex string). */
  token: string;
  /** Bundle id topic. For LA: `${bundleId}.push-type.liveactivity`. */
  topic: string;
  pushType: ApnsPushType;
  /** Full APNs JSON payload (`{ aps: {...}, ...customKeys }`). */
  payload: Record<string, unknown>;
  /**
   * `apns-expiration` epoch seconds. 0 = "deliver immediately or drop".
   * Pass `started_at + 24h` for LA pushes so retries don't outlive the
   * activity (zombie-mitigation).
   */
  expiration?: number;
  /** Defaults to 10 for `alert`/`liveactivity`, 5 for `background`. */
  priority?: ApnsPriority;
  /** Optional message id for collapsing pushes. */
  collapseId?: string;
}

export interface SendApnsResult {
  /** Apple's `apns-id` header from the response, useful for debugging. */
  apnsId: string;
  /** HTTP status (200 on success). */
  status: number;
}

/**
 * APNs HTTP/2 client. Reuse a single instance across requests so the JWT
 * token is cached.
 */
export class ApnsClient {
  private readonly host: string;
  private readonly keyId: string;
  private readonly teamId: string;
  private readonly privateKeyPem: string;
  private cachedToken: { jwt: string; expiresAt: number } | null = null;

  constructor(config: ApnsClientConfig) {
    if (!config.keyId) throw new Error("ApnsClient: keyId is required");
    if (!config.teamId) throw new Error("ApnsClient: teamId is required");
    if (!config.privateKeyPem) {
      throw new Error("ApnsClient: privateKeyPem is required");
    }

    this.keyId = config.keyId;
    this.teamId = config.teamId;
    this.privateKeyPem = config.privateKeyPem;
    this.host =
      config.host ?? (config.sandbox ? APNS_SANDBOX_HOST : APNS_PROD_HOST);
  }

  /**
   * Mint (or reuse) the bearer token Apple expects. Tokens are valid for
   * up to an hour; we refresh ~10m before expiry to be safe.
   */
  private async getAuthToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.jwt;
    }

    const key = await importPKCS8(this.privateKeyPem, "ES256");
    const issuedAt = Math.floor(now / 1000);

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId, typ: "JWT" })
      .setIssuer(this.teamId)
      .setIssuedAt(issuedAt)
      .sign(key);

    this.cachedToken = { jwt, expiresAt: now + TOKEN_LIFETIME_MS };
    return jwt;
  }

  /**
   * Send a single push. Throws on non-2xx responses with the body as the
   * error message so callers can record `last_error` on `notification_jobs`.
   */
  async send(args: SendApnsArgs): Promise<SendApnsResult> {
    const token = await this.getAuthToken();
    const priority =
      args.priority ?? (args.pushType === "background" ? 5 : 10);

    const headers: Record<string, string> = {
      authorization: `bearer ${token}`,
      "apns-topic": args.topic,
      "apns-push-type": args.pushType,
      "apns-priority": String(priority),
      "content-type": "application/json",
    };
    if (typeof args.expiration === "number") {
      headers["apns-expiration"] = String(args.expiration);
    }
    if (args.collapseId) {
      headers["apns-collapse-id"] = args.collapseId;
    }

    const url = `${this.host}/3/device/${args.token}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(args.payload),
    });

    const apnsId = res.headers.get("apns-id") ?? "";
    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        // best-effort
      }
      throw new ApnsError(
        `APNs ${res.status} ${bodyText || res.statusText}`,
        res.status,
        apnsId,
        bodyText,
      );
    }

    return { apnsId, status: res.status };
  }
}

/**
 * Convenience factory — read config from env once, return a singleton-friendly
 * client. Caller decides whether to memoize.
 */
export function createApnsClient(config: ApnsClientConfig): ApnsClient {
  return new ApnsClient(config);
}

/**
 * Typed error thrown by `ApnsClient.send` on non-2xx responses. Exposes the
 * Apple `apns-id` and raw body so callers can record audit data.
 */
export class ApnsError extends Error {
  readonly status: number;
  readonly apnsId: string;
  readonly responseBody: string;

  constructor(message: string, status: number, apnsId: string, body: string) {
    super(message);
    this.name = "ApnsError";
    this.status = status;
    this.apnsId = apnsId;
    this.responseBody = body;
  }
}
