import { NextResponse } from "next/server";

import { generateDeterministicAssistantReply } from "@/lib/assistant";
import { getConfiguredModelProvider } from "@/lib/providers/openai-compatible";
import type { ModelPrompt } from "@/lib/providers/types";
import type { ProjectWorkspace, WorkspaceMessage } from "@/types/workspace";

const MAX_MESSAGE_LENGTH = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkspace(value: unknown): value is ProjectWorkspace {
  if (!isRecord(value)) return false;
  const request = isRecord(value.request) ? value.request : null;
  const memory = isRecord(value.memory) ? value.memory : null;
  const plan = isRecord(value.plan) ? value.plan : null;
  return Boolean(
    typeof value.id === "string" &&
      request && typeof request.idea === "string" &&
      memory && Array.isArray(memory.confirmedRequirements) &&
      Array.isArray(memory.openQuestions) &&
      plan && typeof plan.summary === "string" && Array.isArray(plan.stack) &&
      Array.isArray(plan.roadmap) &&
      Array.isArray(value.messages),
  );
}

function contextFor(workspace: ProjectWorkspace) {
  return [
    `Project: ${workspace.name}`,
    `Idea: ${workspace.request.idea}`,
    `Category: ${workspace.request.category}`,
    `Budget INR: ${workspace.request.budgetInr ?? "not specified"}`,
    `Experience: ${workspace.request.experienceLevel}`,
    `Preferred technologies: ${workspace.request.preferredTechnologies.join(", ") || "none"}`,
    `Deployment: ${workspace.request.deploymentPreference}`,
    `Additional requirements: ${workspace.request.additionalRequirements || "none"}`,
    `Confirmed requirements: ${workspace.memory.confirmedRequirements.join(" | ")}`,
    `Open questions: ${workspace.memory.openQuestions.join(" | ") || "none"}`,
    `Current plan: ${workspace.plan.summary}`,
    `Current stack: ${workspace.plan.stack.map((item) => item.toolName).join(", ")}`,
  ].join("\n");
}

function recentMessages(workspace: ProjectWorkspace) {
  return workspace.messages.slice(-8).map((message: WorkspaceMessage) => ({
    role: message.role,
    content: message.content.slice(0, 2_000),
  }));
}

function providerSystemPrompt() {
  return [
    "You are Medharya AI, a practical technical decision assistant.",
    "Use the structured project context and recent messages; do not invent research, prices, citations, or verified compatibility.",
    "Preserve user-confirmed decisions unless the user explicitly asks to reconsider them.",
    "Distinguish assumptions, catalogue evidence, live research, and model suggestions.",
    "If important information is missing, ask one useful clarifying question.",
    "Do not claim that a tool call, deployment, or web search happened unless the server result says it did.",
    "Keep the answer concise and beginner-friendly.",
  ].join(" ");
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.message !== "string" || !isWorkspace(body.workspace)) {
      return NextResponse.json({ error: "A valid workspace and message are required." }, { status: 400 });
    }

    const message = body.message.trim();
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
    }

    const workspace = body.workspace;
    const provider = getConfiguredModelProvider();
    if (provider) {
      const prompt: ModelPrompt = {
        system: providerSystemPrompt(),
        context: contextFor(workspace),
        recentMessages: recentMessages(workspace),
        userMessage: message,
      };
      const result = await provider.complete(prompt);
      if (result.status === "available" && result.text) {
        return NextResponse.json({
          content: result.text,
          source: "model-assisted",
          provider: result.provider,
          model: result.model,
        });
      }

      const fallback = generateDeterministicAssistantReply(workspace, message);
      return NextResponse.json({
        ...fallback,
        notice: "The configured model provider was unavailable, so Medharya used its deterministic catalogue fallback.",
        providerReason: result.reason,
      });
    }

    return NextResponse.json({
      ...generateDeterministicAssistantReply(workspace, message),
      notice: "No server-side model provider is configured; this is a deterministic catalogue fallback.",
    });
  } catch {
    return NextResponse.json({ error: "The chat request could not be processed safely." }, { status: 400 });
  }
}
