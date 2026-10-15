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

export interface ModelProviderResult {
  status: "available" | "unavailable";
  text?: string;
  provider?: string;
  model?: string;
  reason?: "not-configured" | "timeout" | "rate-limited" | "provider-error" | "invalid-response";
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(prompt: ModelPrompt): Promise<ModelProviderResult>;
}
