import { NextResponse } from "next/server";

import { generateDeterministicAssistantReply } from "@/lib/assistant";
import { appendBranchMessage } from "@/lib/operating-system";
import { getConfiguredModelProvider } from "@/lib/providers/openai-compatible";
import type { ModelPrompt } from "@/lib/providers/types";
import { citationsForEvidence } from "@/lib/research/evidence";
import {
  getCurrentUser,
  getOwnedProject,
  RepositoryError,
  updateOwnedProjectWorkspace,
} from "@/lib/server/repository";
import { appendWorkspaceMessage, createStableId } from "@/lib/workspace";
import type { ResearchCitation } from "@/types/research";
import type { ProjectWorkspace, WorkspaceMessage, WorkspaceMessageCitation } from "@/types/workspace";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_PROJECT_ID_LENGTH = 200;
const MAX_BRANCH_ID_LENGTH = 200;

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

function branchFor(workspace: ProjectWorkspace, branchId: string | undefined) {
  if (!branchId) return null;
  return workspace.operatingSystem?.branches.find((branch) => branch.id === branchId) ?? null;
}

function evidenceContext(workspace: ProjectWorkspace, branchId?: string) {
  const sources = new Map((workspace.researchSources ?? []).map((source) => [source.id, source]));
  const branch = branchFor(workspace, branchId);
  const allowedFindingIds = branch ? new Set(branch.researchFindingIds) : null;
  const findingEvidenceIds = new Set(
    workspace.researchFindings
      .filter((finding) => !allowedFindingIds || allowedFindingIds.has(finding.id))
      .flatMap((finding) => finding.evidenceId ? [finding.evidenceId] : []),
  );
  const records = (workspace.researchEvidence ?? [])
    .filter((record) => !allowedFindingIds || findingEvidenceIds.has(record.id))
    .slice(-12);
  if (!records.length) return "No live research evidence is attached to this project.";
  return records.map((record) => {
    const source = sources.get(record.sourceId);
    return `[evidence:${record.id}] ${source?.title ?? "Research source"} (${record.verificationStatus}): ${record.text.slice(0, 1_500)}`;
  }).join("\n");
}

function contextFor(workspace: ProjectWorkspace, branchId?: string) {
  const branch = branchFor(workspace, branchId);
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
    `Recent project summary: ${workspace.memory.recentSummary}`,
    `Current plan: ${workspace.plan.summary}`,
    `Current stack: ${workspace.plan.stack.map((item) => item.toolName).join(", ")}`,
    branch ? `Active branch: ${branch.name} — ${branch.description}` : "Active branch: main project conversation",
    branch ? `Branch requirements: ${branch.requirements.join(" | ") || "none"}` : "",
    "Evidence records (cite only with the exact [evidence:ID] marker):",
    evidenceContext(workspace, branchId),
  ].filter(Boolean).join("\n");
}

function recentMessages(workspace: ProjectWorkspace, branchId: string | undefined, userMessage: string) {
  const branch = branchFor(workspace, branchId);
  const messages = branch ? branch.messages : workspace.messages;
  return messages
    .slice(-8)
    .filter((message, index, values) => !(index === values.length - 1 && message.role === "user" && message.content.trim() === userMessage.trim()))
    .map((message: WorkspaceMessage) => ({
      role: message.role,
      content: message.content.slice(0, 2_000),
    }));
}

function providerSystemPrompt() {
  return [
    "You are Medharya AI, a practical technical decision assistant.",
    "Use the server-owned structured project context and recent messages; do not invent research, prices, citations, verified compatibility, or actions.",
    "Preserve user-confirmed decisions unless the user explicitly asks to reconsider them.",
    "Distinguish assumptions, curated catalogue evidence, live search snippets, retrieved page evidence, and model suggestions.",
    "If you rely on an evidence record, cite it immediately with the exact marker [evidence:ID] from the supplied evidence records. Never invent an evidence ID or URL.",
    "A search snippet or retrieved page is source-backed evidence, not human verification. Say so when it matters.",
    "If important information is missing, ask one useful clarifying question.",
    "Do not claim that a tool call, deployment, or web search happened unless the server result says it did.",
    "Keep the answer concise and beginner-friendly.",
  ].join(" ");
}

function modelCitationIds(text: string) {
  return [...text.matchAll(/\[evidence:([A-Za-z0-9_-]+)\]/g)].map((match) => match[1]);
}

function cleanModelText(text: string) {
  return text.replace(/\[evidence:[A-Za-z0-9_-]+\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function workspaceCitations(citations: ResearchCitation[]): WorkspaceMessageCitation[] {
  return citations.map((citation) => ({
    evidenceId: citation.evidenceId,
    sourceId: citation.sourceId,
    title: citation.title,
    url: citation.url,
    retrievedAt: citation.retrievedAt,
  }));
}

interface GeneratedReply {
  content: string;
  source: "deterministic-fallback" | "model-assisted";
  provider?: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  notice?: string;
  providerReason?: string;
  citations?: WorkspaceMessageCitation[];
}

async function generateReply(workspace: ProjectWorkspace, message: string, branchId?: string): Promise<GeneratedReply> {
  const provider = getConfiguredModelProvider();
  if (!provider) {
    return {
      ...generateDeterministicAssistantReply(workspace, message),
      notice: "No server-side model provider is configured; this is a deterministic catalogue fallback.",
    };
  }

  const prompt: ModelPrompt = {
    system: providerSystemPrompt(),
    context: contextFor(workspace, branchId),
    recentMessages: recentMessages(workspace, branchId, message),
    userMessage: message,
  };
  const result = await provider.complete(prompt);
  if (result.status === "available" && result.text) {
    const citationIds = modelCitationIds(result.text);
    const knownEvidenceIds = new Set((workspace.researchEvidence ?? []).map((record) => record.id));
    if (citationIds.some((id) => !knownEvidenceIds.has(id))) {
      return {
        ...generateDeterministicAssistantReply(workspace, message),
        provider: result.provider,
        model: result.model,
        notice: "The configured model returned an unknown evidence citation, so Medharya used its deterministic catalogue fallback.",
        providerReason: "invalid-response",
      };
    }
    const citations = workspaceCitations(citationsForEvidence(citationIds, workspace.researchEvidence ?? [], workspace.researchSources ?? []));
    if (citationIds.length && citations.length !== new Set(citationIds).size) {
      return {
        ...generateDeterministicAssistantReply(workspace, message),
        provider: result.provider,
        model: result.model,
        notice: "The configured model returned an evidence citation that could not be resolved, so Medharya used its deterministic catalogue fallback.",
        providerReason: "invalid-response",
      };
    }
    return {
      content: cleanModelText(result.text),
      source: "model-assisted",
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      ...(citations.length ? { citations } : {}),
      ...(citationIds.length && !citations.length ? { notice: "The model returned no valid project evidence IDs, so no citations were attached." } : {}),
    };
  }

  return {
    ...generateDeterministicAssistantReply(workspace, message),
    notice: "The configured model provider was unavailable, so Medharya used its deterministic catalogue fallback.",
    providerReason: result.reason,
  };
}

function newMessage(
  role: WorkspaceMessage["role"],
  content: string,
  source: WorkspaceMessage["source"],
  id = createStableId("message"),
  citations?: WorkspaceMessageCitation[],
): WorkspaceMessage {
  return {
    id,
    role,
    content,
    source,
    ...(citations?.length ? { citations } : {}),
    createdAt: new Date().toISOString(),
  };
}

async function chatForOwnedProject(
  projectId: string,
  ownerUserId: string,
  message: string,
  branchId: string | undefined,
  messageId: string | undefined,
) {
  const project = await getOwnedProject(projectId, ownerUserId);
  if (!project) return null;
  if (branchId && !branchFor(project.workspace, branchId)) return "invalid-branch" as const;

  if (messageId) {
    const existingMessages = branchFor(project.workspace, branchId)?.messages ?? project.workspace.messages;
    const existingIndex = existingMessages.findIndex((candidate) => candidate.id === messageId);
    const existingAssistant = existingIndex >= 0 ? existingMessages[existingIndex + 1] : undefined;
    if (existingAssistant?.role === "assistant") {
      return {
        reply: {
          content: existingAssistant.content,
          source: existingAssistant.source === "model-assisted" ? "model-assisted" : "deterministic-fallback",
          ...(existingAssistant.citations ? { citations: existingAssistant.citations } : {}),
        },
        workspace: project.workspace,
      };
    }
  }

  const reply = await generateReply(project.workspace, message, branchId);
  const userMessage = newMessage("user", message, "user", messageId);
  const assistantMessage = newMessage("assistant", reply.content, reply.source, undefined, reply.citations);
  const updated = await updateOwnedProjectWorkspace(projectId, ownerUserId, (currentWorkspace) => {
    const withUser = branchId
      ? appendBranchMessage(currentWorkspace, branchId, userMessage)
      : appendWorkspaceMessage(currentWorkspace, userMessage);
    return branchId
      ? appendBranchMessage(withUser, branchId, assistantMessage)
      : appendWorkspaceMessage(withUser, assistantMessage);
  });
  return { reply, workspace: updated?.workspace ?? null };
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.message !== "string") {
      return NextResponse.json({ error: "A valid message is required." }, { status: 400 });
    }

    const message = body.message.trim();
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
    }

    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const branchId = typeof body.branchId === "string" && body.branchId.trim() ? body.branchId.trim() : undefined;
    const messageId = typeof body.messageId === "string" && body.messageId.trim() ? body.messageId.trim() : undefined;
    if (projectId.length > MAX_PROJECT_ID_LENGTH || branchId && branchId.length > MAX_BRANCH_ID_LENGTH || messageId && messageId.length > 200) {
      return NextResponse.json({ error: "The chat context identifier is invalid." }, { status: 400 });
    }

    if (projectId) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Authentication is required for server-owned project chat." }, { status: 401 });
      const result = await chatForOwnedProject(projectId, user.id, message, branchId, messageId);
      if (result === "invalid-branch") return NextResponse.json({ error: "The requested project branch was not found." }, { status: 400 });
      if (!result || !result.workspace) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      return NextResponse.json({
        ...result.reply,
        workspace: result.workspace,
        contextSource: "server-owned",
      });
    }

    if (!isWorkspace(body.workspace)) {
      return NextResponse.json({ error: "A valid workspace is required for local draft chat." }, { status: 400 });
    }
    if (branchId && !branchFor(body.workspace, branchId)) {
      return NextResponse.json({ error: "The requested project branch was not found." }, { status: 400 });
    }
    const reply = await generateReply(body.workspace, message, branchId);
    return NextResponse.json({
      ...reply,
      contextSource: "client-local-draft",
      notice: `${reply.notice ?? ""}${reply.notice ? " " : ""}This local draft response was not persisted by the server.`.trim(),
    });
  } catch (error) {
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The chat request could not be processed safely." }, { status: 400 });
  }
}
