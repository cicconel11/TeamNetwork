import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LINKEDIN_INTEGRATION_DISABLED_CODE } from "@/lib/linkedin/config";
import {
  getLinkedInIntegrationStatus,
  isLinkedInLoginEnabled,
} from "@/lib/linkedin/config.server";

const VALID_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const configPath = path.resolve(import.meta.dirname, "..", "src", "lib", "linkedin", "config.ts");
const configSource = fs.readFileSync(configPath, "utf8");

function withLinkedInEnv(
  env: {
    clientId?: string;
    clientSecret?: string;
    encryptionKey?: string;
  },
  run: () => void,
) {
  const previous = {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    encryptionKey: process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY,
  };

  if (env.clientId === undefined) {
    delete process.env.LINKEDIN_CLIENT_ID;
  } else {
    process.env.LINKEDIN_CLIENT_ID = env.clientId;
  }

  if (env.clientSecret === undefined) {
    delete process.env.LINKEDIN_CLIENT_SECRET;
  } else {
    process.env.LINKEDIN_CLIENT_SECRET = env.clientSecret;
  }

  if (env.encryptionKey === undefined) {
    delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = env.encryptionKey;
  }

  try {
    run();
  } finally {
    if (previous.clientId === undefined) {
      delete process.env.LINKEDIN_CLIENT_ID;
    } else {
      process.env.LINKEDIN_CLIENT_ID = previous.clientId;
    }

    if (previous.clientSecret === undefined) {
      delete process.env.LINKEDIN_CLIENT_SECRET;
    } else {
      process.env.LINKEDIN_CLIENT_SECRET = previous.clientSecret;
    }

    if (previous.encryptionKey === undefined) {
      delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = previous.encryptionKey;
    }
  }
}

test("linkedin integration is available when all env vars are valid", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      encryptionKey: VALID_KEY,
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: true,
        reason: null,
      });
    },
  );
});

test("linkedin integration is disabled when required env vars are missing", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: undefined,
      encryptionKey: VALID_KEY,
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: false,
        reason: "not_configured",
      });
    },
  );
});

test("linkedin integration is disabled when the encryption key is malformed", () => {
  withLinkedInEnv(
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      encryptionKey: "z".repeat(64),
    },
    () => {
      assert.deepEqual(getLinkedInIntegrationStatus(), {
        oauthAvailable: false,
        reason: "not_configured",
      });
    },
  );
});

test("isLinkedInLoginEnabled always returns true", () => {
  assert.equal(isLinkedInLoginEnabled(), true);
});

test("browser-safe linkedin config does not import token encryption helpers", () => {
  assert.ok(LINKEDIN_INTEGRATION_DISABLED_CODE.length > 0);
  assert.doesNotMatch(configSource, /token-encryption/);
});
