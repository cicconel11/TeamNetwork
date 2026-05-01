import OpenAI from "openai";
import { assertModelPriceConfigured, recordSpend } from "@/lib/ai/spend";

// ---------------------------------------------------------------------------
// Embedding client factory
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-embedding-001";
const EXPECTED_DIMENSIONS = 768;

function getEmbeddingConfig() {
  const baseURL = process.env.EMBEDDING_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
  return { baseURL, apiKey, model };
}

export function createEmbeddingClient(): OpenAI {
  const { baseURL, apiKey } = getEmbeddingConfig();
  if (!apiKey) {
    throw new Error(
      "No embedding API key configured. Set EMBEDDING_API_KEY."
    );
  }
  return new OpenAI({ apiKey, baseURL });
}

export function getEmbeddingModel(): string {
  return getEmbeddingConfig().model;
}

// ---------------------------------------------------------------------------
// Embedding generation
// ---------------------------------------------------------------------------

async function chargeEmbeddingUsage(
  orgId: string | undefined,
  model: string,
  // OpenAI SDK exposes `prompt_tokens` on embeddings usage; total_tokens covers the rest.
  usage: { prompt_tokens?: number | null; total_tokens?: number | null } | null | undefined,
  spendBypass?: boolean,
): Promise<void> {
  if (!orgId || !usage) return;
  const inputTokens = usage.prompt_tokens ?? usage.total_tokens ?? 0;
  await recordSpend({
    orgId,
    model,
    inputTokens,
    outputTokens: 0,
    surface: "embedding",
    bypass: spendBypass,
  });
}

/**
 * Generate a single embedding vector for the given text.
 */
export async function generateEmbedding(
  text: string,
  orgId?: string,
  spendBypass?: boolean,
): Promise<number[]> {
  const client = createEmbeddingClient();
  const model = getEmbeddingModel();
  if (orgId) assertModelPriceConfigured(model, { bypass: spendBypass });

  const response = await client.embeddings.create({
    model,
    input: text,
    dimensions: EXPECTED_DIMENSIONS,
  });

  await chargeEmbeddingUsage(orgId, model, (response as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage, spendBypass);

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * The OpenAI embeddings API supports up to ~2048 inputs per request.
 */
export async function generateEmbeddings(
  texts: string[],
  orgId?: string,
  spendBypass?: boolean,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = createEmbeddingClient();
  const model = getEmbeddingModel();
  if (orgId) assertModelPriceConfigured(model, { bypass: spendBypass });

  const response = await client.embeddings.create({
    model,
    input: texts,
    dimensions: EXPECTED_DIMENSIONS,
  });

  await chargeEmbeddingUsage(orgId, model, (response as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage, spendBypass);

  // Validate response count matches input count
  if (response.data.length !== texts.length) {
    throw new Error(
      `Embedding response count mismatch: expected ${texts.length}, got ${response.data.length}`
    );
  }

  // Response data is sorted by index — map back to input order
  const sorted = [...response.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}
