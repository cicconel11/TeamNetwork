import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "@/lib/crypto/token-encryption";
import {
  encryptMobileHandoffToken,
  decryptMobileHandoffToken,
  deriveHandoffKeyId,
  UnknownHandoffKeyIdError,
} from "@/lib/auth/mobile-oauth";

// Two distinct valid 64-hex-char keys (32 bytes each).
const CURRENT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PREVIOUS_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
// A third key never installed in the keyring — used to mint a blob whose id is
// unknown to the current process.
const STRANGER_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

let savedCurrent: string | undefined;
let savedPrevious: string | undefined;

beforeEach(() => {
  savedCurrent = process.env.AUTH_HANDOFF_ENCRYPTION_KEY;
  savedPrevious = process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS;
  process.env.AUTH_HANDOFF_ENCRYPTION_KEY = CURRENT_KEY;
  delete process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  if (savedCurrent === undefined) delete process.env.AUTH_HANDOFF_ENCRYPTION_KEY;
  else process.env.AUTH_HANDOFF_ENCRYPTION_KEY = savedCurrent;
  if (savedPrevious === undefined) delete process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS;
  else process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS = savedPrevious;
});

describe("mobile-handoff encryption (key-id versioned wrapper)", () => {
  describe("round-trip under current key", () => {
    it("decrypts what it encrypts", () => {
      const plaintext = "eyJhbGciOi.mobile-access-token.signature";
      const blob = encryptMobileHandoffToken(plaintext);
      assert.equal(decryptMobileHandoffToken(blob), plaintext);
    });

    it("prefixes the current key id -> 4 colon-parts (keyId:iv:tag:ct)", () => {
      const blob = encryptMobileHandoffToken("token");
      const parts = blob.split(":");
      assert.equal(parts.length, 4, "expected keyId:iv:authTag:ciphertext");
      assert.equal(parts[0], deriveHandoffKeyId(CURRENT_KEY));
    });
  });

  describe("rotation window", () => {
    it("decrypts a blob minted under the PREVIOUS key when _PREVIOUS is set", () => {
      // Mint a versioned blob as if the PREVIOUS key had been the current key.
      const previousBlob = `${deriveHandoffKeyId(PREVIOUS_KEY)}:${encryptToken("rotated-token", PREVIOUS_KEY)}`;

      // Without _PREVIOUS set, the previous key id is unknown.
      assert.throws(() => decryptMobileHandoffToken(previousBlob), UnknownHandoffKeyIdError);

      // With _PREVIOUS set, the keyring resolves it.
      process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS = PREVIOUS_KEY;
      assert.equal(decryptMobileHandoffToken(previousBlob), "rotated-token");
    });

    it("still decrypts current-key blobs while _PREVIOUS is set", () => {
      process.env.AUTH_HANDOFF_ENCRYPTION_KEY_PREVIOUS = PREVIOUS_KEY;
      const blob = encryptMobileHandoffToken("current-token");
      assert.equal(decryptMobileHandoffToken(blob), "current-token");
    });
  });

  describe("unknown key id", () => {
    it("throws UnknownHandoffKeyIdError (not a generic decrypt error)", () => {
      const strangerBlob = `${deriveHandoffKeyId(STRANGER_KEY)}:${encryptToken("x", STRANGER_KEY)}`;
      assert.throws(
        () => decryptMobileHandoffToken(strangerBlob),
        (err: unknown) => err instanceof UnknownHandoffKeyIdError
      );
    });

    it("carries no ciphertext or key material in its message", () => {
      const strangerBlob = `${deriveHandoffKeyId(STRANGER_KEY)}:${encryptToken("secret", STRANGER_KEY)}`;
      try {
        decryptMobileHandoffToken(strangerBlob);
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof UnknownHandoffKeyIdError);
        assert.equal(err.message, "unknown handoff key id");
      }
    });
  });

  describe("legacy back-compat (3-part, unversioned blob)", () => {
    it("decrypts a raw shared encryptToken blob via the current key", () => {
      // Blob shape from before versioning: no key-id prefix, exactly 3 parts.
      const legacyBlob = encryptToken("legacy-token", CURRENT_KEY);
      assert.equal(legacyBlob.split(":").length, 3);
      assert.equal(decryptMobileHandoffToken(legacyBlob), "legacy-token");
    });
  });

  describe("shared crypto isolation (proves 9 other callers unaffected)", () => {
    it("raw encryptToken/decryptToken 3-part round-trip is unchanged", () => {
      const plaintext = "some-long-lived-oauth-refresh-token";
      const encrypted = encryptToken(plaintext, CURRENT_KEY);
      assert.equal(encrypted.split(":").length, 3, "shared format must stay 3 parts");
      assert.equal(decryptToken(encrypted, CURRENT_KEY), plaintext);
    });
  });
});
