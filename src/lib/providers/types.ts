export interface ModelPromptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelPrompt {
  system: string;
  context: string;
  recentMessages: ModelPromptMessage[];
  userMessage: string;
}

export const PROVIDER_ERROR_REASONS = {
  missingConfig: "missing-config",
  auth: "auth",
  rateLimit: "rate-limit",
  timeout: "timeout",
  transientError: "transient-error",
  invalidResponse: "invalid-response",
} as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR_REASONS)[keyof typeof PROVIDER_ERROR_REASONS];
export type ModelProviderErrorReason = ProviderErrorReason;

export interface ModelProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelProviderResult {
  status: "available" | "unavailable";
  text?: string;
  provider?: string;
  model?: string;
  baseModel?: string;
  adapterVersion?: string;
  reason?: ProviderErrorReason;
  usage?: ModelProviderUsage;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: ModelPrompt): Promise<ModelProviderResult>;
}
