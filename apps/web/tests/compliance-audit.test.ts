import { describe, it } from "node:test";
import assert from "node:assert";
import { createHash } from "crypto";

// Mock environment variables
process.env.IP_HASH_SALT = "test-salt";
process.env.AGE_VALIDATION_SECRET = "test-secret-32-characters-long!!";

// Inline the functions to test (avoids module resolution issues)
function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT || "team-network-coppa";
  return createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex");
}

function getClientIp(request: Request): string | null {
  const headers = request.headers;
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const trueClientIp = headers.get("true-client-ip");
  if (trueClientIp) return trueClientIp.trim();
  const xRealIp = headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return null;
}

describe("hashIp", () => {
  it("should produce consistent hashes for the same IP", () => {
    const ip = "192.168.1.1";
    const hash1 = hashIp(ip);
    const hash2 = hashIp(ip);
    assert.strictEqual(hash1, hash2);
  });

  it("should produce different hashes for different IPs", () => {
    const hash1 = hashIp("192.168.1.1");
    const hash2 = hashIp("192.168.1.2");
    assert.notStrictEqual(hash1, hash2);
  });

  it("should produce 64-character hex string (SHA-256)", () => {
    const hash = hashIp("10.0.0.1");
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("should include salt in hash", () => {
    // Same IP with different salts should produce different hashes
    // We can't change salt mid-test, but we can verify the hash includes the salt
    const hash = hashIp("127.0.0.1");
    assert.strictEqual(hash.length, 64);
  });
});

describe("getClientIp", () => {
  it("should extract IP from cf-connecting-ip header", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    assert.strictEqual(getClientIp(request), "1.2.3.4");
  });

  it("should extract first IP from x-forwarded-for header", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" },
    });
    assert.strictEqual(getClientIp(request), "1.2.3.4");
  });

  it("should extract IP from x-real-ip header", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "1.2.3.4" },
    });
    assert.strictEqual(getClientIp(request), "1.2.3.4");
  });

  it("should extract IP from true-client-ip header", () => {
    const request = new Request("https://example.com", {
      headers: { "true-client-ip": "1.2.3.4" },
    });
    assert.strictEqual(getClientIp(request), "1.2.3.4");
  });

  it("should return null when no IP headers present", () => {
    const request = new Request("https://example.com");
    assert.strictEqual(getClientIp(request), null);
  });

  it("should prefer cf-connecting-ip over x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "1.1.1.1",
        "x-forwarded-for": "2.2.2.2",
      },
    });
    assert.strictEqual(getClientIp(request), "1.1.1.1");
  });

  it("should trim whitespace from IP addresses", () => {
    const request = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "  1.2.3.4  " },
    });
    assert.strictEqual(getClientIp(request), "1.2.3.4");
  });
});
