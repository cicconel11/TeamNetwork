import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encryptToken,
  decryptToken,
  getEncryptionKeyBuffer,
} from "@/lib/crypto/token-encryption";

// Valid 64-hex-char key (32 bytes)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token-encryption", () => {
  describe("getEncryptionKeyBuffer", () => {
    it("returns a 32-byte buffer for valid 64-hex key", () => {
      const buf = getEncryptionKeyBuffer(TEST_KEY);
      assert.equal(buf.length, 32);
    });

    it("throws on empty key", () => {
      assert.throws(() => getEncryptionKeyBuffer(""), /must not be empty/);
    });

    it("throws on wrong-length key", () => {
      assert.throws(() => getEncryptionKeyBuffer("abcd"), /64 hex characters/);
    });

    it("throws on non-hex characters", () => {
      assert.throws(() => getEncryptionKeyBuffer("z".repeat(64)), /64 hex characters/);
    });
  });

  describe("encryptToken / decryptToken", () => {
    it("round-trips a plaintext token", () => {
      const plaintext = "my-secret-access-token-12345";
      const encrypted = encryptToken(plaintext, TEST_KEY);
      const decrypted = decryptToken(encrypted, TEST_KEY);
      assert.equal(decrypted, plaintext);
    });

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      const plaintext = "same-token";
      const a = encryptToken(plaintext, TEST_KEY);
      const b = encryptToken(plaintext, TEST_KEY);
      assert.notEqual(a, b);
    });

    it("round-trips an empty string", () => {
      const encrypted = encryptToken("", TEST_KEY);
      const decrypted = decryptToken(encrypted, TEST_KEY);
      assert.equal(decrypted, "");
    });

    it("round-trips unicode content", () => {
      const plaintext = "token-with-unicode-\u00e9\u00e8\u00ea";
      const encrypted = encryptToken(plaintext, TEST_KEY);
      const decrypted = decryptToken(encrypted, TEST_KEY);
      assert.equal(decrypted, plaintext);
    });
  });

  describe("tamper detection", () => {
    it("throws on tampered ciphertext", () => {
      const encrypted = encryptToken("secret", TEST_KEY);
      const parts = encrypted.split(":");
      // Flip a character in the ciphertext part
      const tampered = parts[0] + ":" + parts[1] + ":AAAA" + parts[2].slice(4);
      assert.throws(() => decryptToken(tampered, TEST_KEY));
    });

    it("throws on invalid format (not 3 parts)", () => {
      assert.throws(() => decryptToken("onlytwoparts:here", TEST_KEY), /Invalid encrypted token format/);
    });

    it("throws when using wrong key to decrypt", () => {
      const otherKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      const encrypted = encryptToken("secret", TEST_KEY);
      assert.throws(() => decryptToken(encrypted, otherKey));
    });
  });
});
