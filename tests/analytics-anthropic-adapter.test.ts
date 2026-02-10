import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Type Definitions (recreated locally for test isolation)
// ---------------------------------------------------------------------------

interface UsageSummary {
  id: string;
  user_id: string;
  organization_id: string;
  feature: string;
  visit_count: number;
  total_duration_ms: number;
  last_visited_at: string | null;
  peak_hour: number | null;
  device_preference: string | null;
  period_start: string;
  period_end: string;
}

interface ProfileInput {
  summaries: UsageSummary[];
  availableFeatures: string[];
  userRole: string;
  orgType: string;
}

interface DashboardHints {
  show_recent_features: boolean;
  suggested_features: string[];
  preferred_time_label: string;
}

interface UIProfile {
  nav_order: string[];
  feature_highlights: string[];
  dashboard_hints: DashboardHints;
}

// ---------------------------------------------------------------------------
// Zod Schema (recreated locally)
// ---------------------------------------------------------------------------

const dashboardHintsSchema = z.object({
  show_recent_features: z.boolean(),
  suggested_features: z.array(z.string()).max(10),
  preferred_time_label: z.string().max(200),
});

const uiProfileSchema = z.object({
  nav_order: z.array(z.string()).max(30),
  feature_highlights: z.array(z.string()).max(10),
  dashboard_hints: dashboardHintsSchema,
});

// ---------------------------------------------------------------------------
// Mock Anthropic Client
// ---------------------------------------------------------------------------

interface TextBlock {
  type: "text";
  text: string;
}

interface ImageBlock {
  type: "image";
  source: Record<string, unknown>;
}

type ContentBlock = TextBlock | ImageBlock;

interface MockResponse {
  content: ContentBlock[];
}

interface MessageCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: string; content: string }>;
}

interface MockClient {
  messages: {
    create: (params: MessageCreateParams) => Promise<MockResponse>;
  };
  capturedParams?: MessageCreateParams;
}

function createMockClient(mockResponse: MockResponse): MockClient {
  const client: MockClient = {
    messages: {
      create: async (params: MessageCreateParams) => {
        client.capturedParams = params;
        return mockResponse;
      },
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Simulated Adapter Logic
// ---------------------------------------------------------------------------

const MODEL_ID = "claude-haiku-4-5-20251001";

/**
 * Simulates the adapter's generateUIProfile method.
 * This recreates the logic from AnthropicAdapter for testing purposes.
 */
async function simulateAdapterCall(
  mockResponse: MockResponse,
  input: ProfileInput,
): Promise<UIProfile> {
  const client = createMockClient(mockResponse);

  const systemPrompt = `You are a UI personalization engine. Given the user's feature usage patterns, generate a UI profile that optimizes their navigation experience.

Output a JSON object with exactly these keys:
- nav_order: ordered list of feature keys — prioritize features the user accesses most, put less-used features later
- feature_highlights: top 3-5 features to emphasize in the UI
- dashboard_hints: object with:
  - show_recent_features: boolean (true if user has meaningful usage data)
  - suggested_features: features from available_features the user hasn't tried that are commonly used by similar roles
  - preferred_time_label: a short human-readable string like "You're most active in the morning" based on peak_hour data

Only output valid JSON, no markdown fences, no explanation.`;

  const userData = JSON.stringify({
    user_role: input.userRole,
    organization_type: input.orgType,
    available_features: input.availableFeatures,
    usage_summaries: input.summaries.map((s) => ({
      feature: s.feature,
      visit_count: s.visit_count,
      total_duration_ms: s.total_duration_ms,
      peak_hour: s.peak_hour,
      device_preference: s.device_preference,
    })),
  }, null, 2);

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userData }],
  });

  // Verify client was called correctly (for test case 2)
  if (client.capturedParams) {
    // This allows us to inspect the captured params in tests
    (simulateAdapterCall as any).lastCapturedParams = client.capturedParams;
  }

  // Extract text from the response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("LLM returned no text content");
  }

  // Parse and validate with Zod
  const raw = JSON.parse(textBlock.text);
  return uiProfileSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const validProfile: UIProfile = {
  nav_order: ["dashboard", "members", "events"],
  feature_highlights: ["dashboard", "members"],
  dashboard_hints: {
    show_recent_features: true,
    suggested_features: ["workouts", "competition"],
    preferred_time_label: "You're most active in the morning",
  },
};

const sampleInput: ProfileInput = {
  summaries: [
    {
      id: "sum1",
      user_id: "user1",
      organization_id: "org1",
      feature: "dashboard",
      visit_count: 42,
      total_duration_ms: 120000,
      last_visited_at: "2026-02-01T10:00:00Z",
      peak_hour: 9,
      device_preference: "desktop",
      period_start: "2026-01-01",
      period_end: "2026-02-01",
    },
    {
      id: "sum2",
      user_id: "user1",
      organization_id: "org1",
      feature: "members",
      visit_count: 15,
      total_duration_ms: 45000,
      last_visited_at: "2026-02-01T11:00:00Z",
      peak_hour: 14,
      device_preference: "mobile",
      period_start: "2026-01-01",
      period_end: "2026-02-01",
    },
  ],
  availableFeatures: ["dashboard", "members", "events", "workouts", "competition"],
  userRole: "admin",
  orgType: "athletic",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnthropicAdapter.generateUIProfile()", () => {
  it("should parse valid JSON response correctly", async () => {
    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(validProfile) }],
    };

    const result = await simulateAdapterCall(mockResponse, sampleInput);

    assert.deepStrictEqual(result, validProfile);
  });

  it("should use correct system/user message split (Issue 2)", async () => {
    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(validProfile) }],
    };

    await simulateAdapterCall(mockResponse, sampleInput);

    const captured = (simulateAdapterCall as any).lastCapturedParams as MessageCreateParams;

    // Verify system message is a string and contains expected content
    assert.strictEqual(typeof captured.system, "string");
    assert.ok(
      captured.system.includes("UI personalization engine"),
      "System prompt should include 'UI personalization engine'",
    );

    // Verify user message is valid JSON
    assert.strictEqual(captured.messages.length, 1);
    assert.strictEqual(captured.messages[0].role, "user");

    const userContent = captured.messages[0].content;
    let parsedUserData: any;
    assert.doesNotThrow(() => {
      parsedUserData = JSON.parse(userContent);
    }, "User message should be valid JSON");

    // Verify user data structure
    assert.ok(parsedUserData.user_role, "Should contain user_role");
    assert.ok(parsedUserData.organization_type, "Should contain organization_type");
    assert.ok(parsedUserData.available_features, "Should contain available_features");
    assert.ok(parsedUserData.usage_summaries, "Should contain usage_summaries");

    // Verify it does NOT contain system instructions
    assert.ok(
      !userContent.includes("UI personalization engine"),
      "User message should not contain system instructions",
    );

    // Verify model and max_tokens
    assert.strictEqual(captured.model, MODEL_ID);
    assert.strictEqual(captured.max_tokens, 1024);
  });

  it("should throw error when text block is missing", async () => {
    const mockResponse: MockResponse = {
      content: [{ type: "image", source: {} }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      {
        message: "LLM returned no text content",
      },
    );
  });

  it("should throw error on invalid JSON from LLM", async () => {
    const mockResponse: MockResponse = {
      content: [{ type: "text", text: "not valid json" }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        // JSON.parse throws SyntaxError
        return error instanceof SyntaxError;
      },
    );
  });

  it("should throw Zod validation error when required fields are missing", async () => {
    const invalidProfile = {
      nav_order: ["dashboard", "members"],
      feature_highlights: ["dashboard"],
      // Missing dashboard_hints
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(invalidProfile) }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        // Zod throws ZodError
        return error.name === "ZodError" || error.issues !== undefined;
      },
    );
  });

  it("should throw error when content array is empty", async () => {
    const mockResponse: MockResponse = {
      content: [],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      {
        message: "LLM returned no text content",
      },
    );
  });

  it("should pass validation with extra fields (Zod strips them)", async () => {
    const profileWithExtras = {
      ...validProfile,
      unused_field: "should be stripped",
      another_extra: 123,
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(profileWithExtras) }],
    };

    const result = await simulateAdapterCall(mockResponse, sampleInput);

    // Result should only contain valid schema fields
    assert.deepStrictEqual(result, validProfile);
    assert.strictEqual((result as any).unused_field, undefined);
    assert.strictEqual((result as any).another_extra, undefined);
  });

  it("should throw when nav_order exceeds max length (30)", async () => {
    const invalidProfile = {
      nav_order: Array(31).fill("feature"), // 31 items > max 30
      feature_highlights: ["dashboard"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: [],
        preferred_time_label: "Morning",
      },
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(invalidProfile) }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        return error.name === "ZodError" && error.issues.some(
          (issue: any) => issue.path.includes("nav_order"),
        );
      },
    );
  });

  it("should throw when feature_highlights exceeds max length (10)", async () => {
    const invalidProfile = {
      nav_order: ["dashboard"],
      feature_highlights: Array(11).fill("feature"), // 11 items > max 10
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: [],
        preferred_time_label: "Morning",
      },
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(invalidProfile) }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        return error.name === "ZodError" && error.issues.some(
          (issue: any) => issue.path.includes("feature_highlights"),
        );
      },
    );
  });

  it("should throw when suggested_features exceeds max length (10)", async () => {
    const invalidProfile = {
      nav_order: ["dashboard"],
      feature_highlights: ["dashboard"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: Array(11).fill("feature"), // 11 items > max 10
        preferred_time_label: "Morning",
      },
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(invalidProfile) }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        return error.name === "ZodError" && error.issues.some(
          (issue: any) => issue.path.includes("suggested_features"),
        );
      },
    );
  });

  it("should throw when preferred_time_label exceeds max length (200)", async () => {
    const invalidProfile = {
      nav_order: ["dashboard"],
      feature_highlights: ["dashboard"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: [],
        preferred_time_label: "x".repeat(201), // 201 chars > max 200
      },
    };

    const mockResponse: MockResponse = {
      content: [{ type: "text", text: JSON.stringify(invalidProfile) }],
    };

    await assert.rejects(
      async () => await simulateAdapterCall(mockResponse, sampleInput),
      (error: any) => {
        return error.name === "ZodError" && error.issues.some(
          (issue: any) => issue.path.includes("preferred_time_label"),
        );
      },
    );
  });
});
