import type { ProfileInput, UIProfile } from "./types";

/**
 * Provider-agnostic LLM adapter interface.
 *
 * Each provider implementation (Anthropic, OpenAI, etc.) must satisfy this
 * interface so the profile generator can be swapped without changing
 * business logic.
 */
export interface LLMAdapter {
  readonly providerName: string;
  generateUIProfile(input: ProfileInput): Promise<UIProfile>;
}
