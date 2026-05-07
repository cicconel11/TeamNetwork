import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Save and restore env vars
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    ZAI_API_KEY: process.env.ZAI_API_KEY,
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("embeddings", () => {
  describe("createEmbeddingClient", () => {
    it("throws when no API key is configured", async () => {
      delete process.env.EMBEDDING_API_KEY;
      delete process.env.ZAI_API_KEY;

      // Dynamic import to get fresh module state
      const { createEmbeddingClient } = await import(
        "../src/lib/ai/embeddings"
      );

      assert.throws(
        () => createEmbeddingClient(),
        /No embedding API key configured/
      );
    });

    it("creates client with EMBEDDING_API_KEY", async () => {
      process.env.EMBEDDING_API_KEY = "test-embedding-key";
      process.env.EMBEDDING_BASE_URL = "https://custom.api/v1";

      const { createEmbeddingClient } = await import(
        "../src/lib/ai/embeddings"
      );

      const client = createEmbeddingClient();
      assert.ok(client, "Client should be created");
    });

    it("throws without EMBEDDING_API_KEY even if ZAI_API_KEY is set", async () => {
      delete process.env.EMBEDDING_API_KEY;
      process.env.ZAI_API_KEY = "test-zai-key";

      const { createEmbeddingClient } = await import(
        "../src/lib/ai/embeddings"
      );

      assert.throws(
        () => createEmbeddingClient(),
        /No embedding API key configured/
      );
    });
  });

  describe("getEmbeddingModel", () => {
    it("defaults to gemini-embedding-001", async () => {
      delete process.env.EMBEDDING_MODEL;

      const { getEmbeddingModel } = await import("../src/lib/ai/embeddings");

      assert.equal(getEmbeddingModel(), "gemini-embedding-001");
    });

    it("respects EMBEDDING_MODEL env var", async () => {
      process.env.EMBEDDING_MODEL = "text-embedding-3-large";

      const { getEmbeddingModel } = await import("../src/lib/ai/embeddings");

      assert.equal(getEmbeddingModel(), "text-embedding-3-large");
    });
  });
});
