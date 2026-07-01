/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  consumeMobileHandoff,
  type ConsumeMobileHandoffResult,
} from "../../src/lib/auth/mobile-handoff.ts";

// ── Test doubles ─────────────────────────────────────────────────────────────

// A representative one-time code + the plaintext tokens a successful decrypt
// would yield. Nothing derived from these may ever appear in a log argument.
const HANDOFF_CODE = "s3cr3t-one-time-code-abcdefghijklmnopqrstuvwxyz-0123456789";
const CODE_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const ACCESS_TOKEN = "plaintext-access-token-DO-NOT-LOG-1111";
const REFRESH_TOKEN = "plaintext-refresh-token-DO-NOT-LOG-2222";
const ENC_ACCESS = "enc::access::ciphertext";
const ENC_REFRESH = "enc::refresh::ciphertext";

type RpcResult = {
  data: Array<{ encrypted_access_token: string; encrypted_refresh_token: string }> | null;
  error: { message: string } | null;
};

function makeServiceClient(result: RpcResult) {
  return {
    rpc(fn: string, args: { p_code_hash: string }) {
      assert.equal(fn, "consume_mobile_auth_handoff");
      // The route must hash the code before it reaches the RPC — the raw code
      // must never cross this boundary.
      assert.equal(args.p_code_hash, CODE_HASH);
      assert.notEqual(args.p_code_hash, HANDOFF_CODE);
      return Promise.resolve(result);
    },
  } as any;
}

// Decrypt that maps our known ciphertext to known plaintext.
function realDecrypt(encrypted: string): string {
  if (encrypted === ENC_ACCESS) return ACCESS_TOKEN;
  if (encrypted === ENC_REFRESH) return REFRESH_TOKEN;
  throw new Error("unexpected ciphertext");
}

function failingDecrypt(): string {
  // Mirror the shape of a real crypto failure whose message could carry
  // ciphertext fragments — the code must NOT forward this into the log.
  throw new Error(`Invalid encrypted token format: ${ENC_ACCESS}`);
}

// ── console.error capture ────────────────────────────────────────────────────

type LoggedCall = { message: unknown; args: unknown[] };
let logged: LoggedCall[] = [];
const originalError = console.error;

beforeEach(() => {
  logged = [];
  console.error = (message?: unknown, ...args: unknown[]) => {
    logged.push({ message, args });
  };
});

afterEach(() => {
  console.error = originalError;
});

/** Serialize every captured console.error argument for leak assertions. */
function loggedText(): string {
  return logged
    .map((call) =>
      [call.message, ...call.args]
        .map((part) => {
          if (typeof part === "string") return part;
          try {
            return JSON.stringify(part);
          } catch {
            return String(part);
          }
        })
        .join(" ")
    )
    .join("\n");
}

function assertNoSecretsLogged() {
  const text = loggedText();
  for (const secret of [
    HANDOFF_CODE,
    ACCESS_TOKEN,
    REFRESH_TOKEN,
    ENC_ACCESS,
    ENC_REFRESH,
    CODE_HASH,
  ]) {
    assert.ok(
      !text.includes(secret),
      `log output must not contain secret material (found "${secret.slice(0, 12)}…")`
    );
  }
}

const LOG_CONTEXT = { env: "test", ip: "203.0.113.7" } as const;

// ── U2: logging + no-PII guarantee ───────────────────────────────────────────

describe("consumeMobileHandoff — structured logging + no-PII guarantee", () => {
  it("logs category rpc_error and returns rpc_error when the RPC fails", async () => {
    const result: ConsumeMobileHandoffResult = await consumeMobileHandoff({
      serviceClient: makeServiceClient({
        data: null,
        error: { message: "connection refused" },
      }),
      codeHash: CODE_HASH,
      decrypt: realDecrypt,
      logContext: LOG_CONTEXT,
    });

    assert.equal(result.status, "rpc_error");
    assert.equal(logged.length, 1, "exactly one error should be logged");
    const call = logged[0]!;
    assert.match(String(call.message), /\[mobile-handoff\]/);
    assert.equal((call.args[0] as any).category, "rpc_error");
    assert.equal((call.args[0] as any).env, "test");
    assert.equal((call.args[0] as any).ip, "203.0.113.7");
    assertNoSecretsLogged();
  });

  it("logs category decrypt_error and returns decrypt_error when decryption throws", async () => {
    const result = await consumeMobileHandoff({
      serviceClient: makeServiceClient({
        data: [
          { encrypted_access_token: ENC_ACCESS, encrypted_refresh_token: ENC_REFRESH },
        ],
        error: null,
      }),
      codeHash: CODE_HASH,
      decrypt: failingDecrypt,
      logContext: LOG_CONTEXT,
    });

    assert.equal(result.status, "decrypt_error");
    assert.equal(logged.length, 1);
    assert.equal((logged[0]!.args[0] as any).category, "decrypt_error");
    // The caught error (which embedded ciphertext) must be dropped, not logged.
    assertNoSecretsLogged();
  });

  it("returns the decrypted tokens on success and emits NO error log", async () => {
    const result = await consumeMobileHandoff({
      serviceClient: makeServiceClient({
        data: [
          { encrypted_access_token: ENC_ACCESS, encrypted_refresh_token: ENC_REFRESH },
        ],
        error: null,
      }),
      codeHash: CODE_HASH,
      decrypt: realDecrypt,
      logContext: LOG_CONTEXT,
    });

    assert.deepEqual(result, {
      status: "ok",
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
    });
    assert.equal(logged.length, 0, "success path must not log an error");
  });

  it("treats an empty RPC result as not_found without logging (expected traffic)", async () => {
    const result = await consumeMobileHandoff({
      serviceClient: makeServiceClient({ data: [], error: null }),
      codeHash: CODE_HASH,
      decrypt: realDecrypt,
      logContext: LOG_CONTEXT,
    });

    assert.equal(result.status, "not_found");
    assert.equal(logged.length, 0, "expired/used codes are normal traffic, not errors");
  });

  it("never stringifies the raw code or a decrypted token into any log argument", async () => {
    // Drive both alert-worthy branches in one run and assert the aggregate.
    await consumeMobileHandoff({
      serviceClient: makeServiceClient({ data: null, error: { message: "boom" } }),
      codeHash: CODE_HASH,
      decrypt: realDecrypt,
      logContext: LOG_CONTEXT,
    });
    await consumeMobileHandoff({
      serviceClient: makeServiceClient({
        data: [
          { encrypted_access_token: ENC_ACCESS, encrypted_refresh_token: ENC_REFRESH },
        ],
        error: null,
      }),
      codeHash: CODE_HASH,
      decrypt: failingDecrypt,
      logContext: LOG_CONTEXT,
    });

    assert.equal(logged.length, 2);
    assertNoSecretsLogged();
  });
});

// ── U2: consume route wiring (source-level invariants) ───────────────────────
// The route itself imports createServiceClient / decryptMobileHandoffToken at
// module scope (untestable without experimental module mocks, which this repo's
// runner does not enable), so we assert its wiring by source — matching the
// sibling route tests' source-assertion style — and unit-test the extracted
// core above.

describe("consume route wiring", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/api/auth/mobile-handoff/consume/route.ts"),
    "utf8"
  );

  it("delegates to consumeMobileHandoff with hashed code + derived IP/env", () => {
    assert.match(source, /consumeMobileHandoff\(/);
    assert.match(source, /codeHash: hashMobileHandoffCode\(parsed\.data\.code\)/);
    assert.match(source, /ip: deriveClientIp\(request\)/);
    assert.match(source, /env: resolveHandoffEnv\(\)/);
  });

  it("maps not_found to 400 and rpc/decrypt failures to 500", () => {
    assert.match(source, /"Invalid or expired handoff code"[\s\S]*status: 400/);
    assert.match(source, /"Unable to consume handoff"[\s\S]*status: 500/);
  });

  it("keeps the rate limit + Zod boundary in place", () => {
    assert.match(source, /checkRateLimit\(request/);
    assert.match(source, /feature: "mobile sign-in"/);
    assert.match(source, /requestSchema\.safeParse/);
  });

  it("never logs the raw code in the route", () => {
    assert.doesNotMatch(source, /console\.error[\s\S]*parsed\.data\.code/);
  });
});
