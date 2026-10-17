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
  modelMissing: "model-missing",
  invalidResponse: "invalid-response",
} as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR_REASONS)[keyof typeof PROVIDER_ERROR_REASONS];
export type ModelProviderErrorReason = ProviderErrorReason;

export type ModelProviderState = "configured" | "connecting" | "ready" | "degraded" | "unavailable";

export interface ModelProviderStatus {
  provider: string;
  state: ModelProviderState;
  model?: string;
  baseModel?: string;
  adapterVersion?: string;
  checkedAt?: string;
  lastSuccessfulInferenceAt?: string;
  reason?: ProviderErrorReason;
  /** False means the service responded, but did not attest to the configured identity. */
  identityVerified?: boolean;
}

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
  providerStatus?: ModelProviderStatus;
  identityVerified?: boolean;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: ModelPrompt): Promise<ModelProviderResult>;
  health?: () => Promise<ModelProviderStatus>;
  getStatus?: () => ModelProviderStatus;
}
