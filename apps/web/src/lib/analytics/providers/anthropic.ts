import type { LLMAdapter } from "../llm-adapter";
import type { ProfileInput, UIProfile } from "../types";
import { uiProfileSchema } from "@/lib/schemas/analytics";

const MODEL_ID = "claude-haiku-4-5-20251001";

/**
 * Anthropic Claude implementation of the LLM adapter.
 * Uses Haiku for cost efficiency — personalization doesn't need Opus.
 *
 * The @anthropic-ai/sdk package is loaded dynamically to avoid a hard
 * dependency. Install it with: npm install @anthropic-ai/sdk
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly providerName = "anthropic";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("ANTHROPIC_API_KEY is required for LLM profile generation");
    }
    // Client is initialised lazily in generateUIProfile to allow dynamic import
    this._apiKey = key;
  }

  private _apiKey: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    try {
      // Dynamic import — only resolves if the package is installed
      // Use a variable to prevent TS from resolving the module at compile time
      const moduleName = "@anthropic-ai/sdk";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: Anthropic } = await (import(moduleName) as Promise<any>);
      this.client = new Anthropic({ apiKey: this._apiKey });
      return this.client;
    } catch {
      throw new Error(
        "The @anthropic-ai/sdk package is required for LLM profile generation. " +
        "Install it with: npm install @anthropic-ai/sdk",
      );
    }
  }

  async generateUIProfile(input: ProfileInput): Promise<UIProfile> {
    const client = await this.getClient();

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

    // Extract text from the response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = response.content.find((b: any) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("LLM returned no text content");
    }

    // Parse and validate with Zod
    const raw = JSON.parse(textBlock.text);
    return uiProfileSchema.parse(raw);
  }
}
