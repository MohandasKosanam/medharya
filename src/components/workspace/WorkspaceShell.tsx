"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Brand } from "@/components/layout/Brand";
import type { ResearchResponse } from "@/types/research";
import type { WorkspaceMessage, ProjectWorkspace, WorkspaceRequestPatch } from "@/types/workspace";
import { appendResearchFindings, appendWorkspaceMessage, applyWorkspaceRequestPatch, createStableId } from "@/lib/workspace";
import { generateDeterministicAssistantReply } from "@/lib/assistant";
import { loadProjectWorkspace, saveProjectWorkspace } from "@/lib/workspace-storage";

import { WorkspaceBriefEditor } from "./WorkspaceBriefEditor";
import { WorkspaceChat } from "./WorkspaceChat";
import { WorkspacePlanPanel } from "./WorkspacePlanPanel";

type WorkspaceShellProps = {
  projectId: string;
};

type WorkspaceState = "loading" | "ready" | "missing";

function makeMessage(
  role: WorkspaceMessage["role"],
  content: string,
  source: WorkspaceMessage["source"],
  citations?: WorkspaceMessage["citations"],
): WorkspaceMessage {
  return {
    id: createStableId("message"),
    role,
    content,
    source,
    citations,
    createdAt: new Date().toISOString(),
  };
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [loadState, setLoadState] = useState<WorkspaceState>("loading");
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<{ workspace: ProjectWorkspace; content: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [researchState, setResearchState] = useState<"idle" | "working" | "unavailable" | "error">("idle");
  const [researchMessage, setResearchMessage] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedWorkspace = loadProjectWorkspace(projectId);
      if (savedWorkspace) {
        setWorkspace(savedWorkspace);
        setLoadState("ready");
      } else {
        setLoadState("missing");
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [projectId]);

  function persist(nextWorkspace: ProjectWorkspace) {
    setWorkspace(nextWorkspace);
    if (!saveProjectWorkspace(nextWorkspace)) {
      setPersistenceError("The workspace is visible, but this browser could not persist the latest change.");
    } else {
      setPersistenceError(null);
    }
  }

  async function sendMessage(content: string) {
    if (!workspace || isSending) return;
    setIsSending(true);
    setChatError(null);

    const userMessage = makeMessage("user", content, "user");
    const workspaceWithUserMessage = appendWorkspaceMessage(workspace, userMessage);
    persist(workspaceWithUserMessage);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: workspaceWithUserMessage, message: content }),
      });
      const payload = await readResponse(response);
      if (!response.ok || typeof payload.content !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "The chat service returned an invalid response.");
      }

      const source: WorkspaceMessage["source"] = payload.source === "model-assisted" ? "model-assisted" : "deterministic-fallback";
      const notice = typeof payload.notice === "string" ? `\n\nSource note: ${payload.notice}` : "";
      persist(appendWorkspaceMessage(workspaceWithUserMessage, makeMessage("assistant", `${payload.content}${notice}`, source)));
      setRetryState(null);
    } catch (error) {
      const fallback = generateDeterministicAssistantReply(workspaceWithUserMessage, content);
      persist(appendWorkspaceMessage(workspaceWithUserMessage, makeMessage("assistant", `${fallback.content}\n\nSource note: The server chat route was unavailable, so this response was generated locally from the deterministic catalogue fallback.`, "deterministic-fallback")));
      setChatError(error instanceof Error ? `${error.message} Local fallback used.` : "The server chat route was unavailable. Local fallback used.");
      setRetryState({ workspace: workspaceWithUserMessage, content });
    } finally {
      setIsSending(false);
    }
  }

  async function retryServerResponse() {
    if (!retryState || isSending) return;
    setIsSending(true);
    setChatError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: retryState.workspace, message: retryState.content }),
      });
      const payload = await readResponse(response);
      if (!response.ok || typeof payload.content !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "The chat service returned an invalid response.");
      }
      const source: WorkspaceMessage["source"] = payload.source === "model-assisted" ? "model-assisted" : "deterministic-fallback";
      const notice = typeof payload.notice === "string" ? `\n\nSource note: ${payload.notice}` : "";
      persist(appendWorkspaceMessage(retryState.workspace, makeMessage("assistant", `${payload.content}${notice}`, source)));
      setRetryState(null);
    } catch (error) {
      setChatError(error instanceof Error ? `${error.message} The local fallback remains available.` : "The retry failed. The local fallback remains available.");
    } finally {
      setIsSending(false);
    }
  }

  function saveBriefChanges(patch: WorkspaceRequestPatch) {
    if (!workspace) return;
    const updatedWorkspace = applyWorkspaceRequestPatch(workspace, patch);
    const changeMessage = makeMessage(
      "assistant",
      `The brief was updated with your approval and the baseline plan was regenerated as version ${updatedWorkspace.plan.version}. Review the stack, trade-offs, and open questions before treating it as a decision.`,
      "deterministic-fallback",
    );
    persist(appendWorkspaceMessage(updatedWorkspace, changeMessage));
    setResearchMessage(null);
  }

  async function researchDirection() {
    if (!workspace || researchState === "working") return;
    setResearchState("working");
    setResearchMessage("Preparing a focused query from the current brief and selected stack…");

    const query = `${workspace.request.idea} official documentation ${workspace.plan.stack.slice(0, 4).map((item) => item.toolName).join(" ")}`.slice(0, 300);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = await readResponse(response) as unknown as Partial<ResearchResponse> & { error?: string };
      const message = typeof payload.message === "string" ? payload.message : payload.error ?? "Research was not available.";
      setResearchMessage(message);
      if (!response.ok || payload.status === "unavailable") {
        setResearchState(payload.status === "unavailable" ? "unavailable" : "error");
        return;
      }

      const findings = Array.isArray(payload.findings) ? payload.findings : [];
      if (!findings.length) {
        setResearchState("idle");
        return;
      }

      const withFindings = appendResearchFindings(workspace, findings);
      const citations = findings.slice(0, 5).map((finding) => ({
        title: finding.title,
        url: finding.url,
        retrievedAt: finding.retrievedAt,
      }));
      const researchMessage = makeMessage(
        "assistant",
        `${message}\n\nThese results are attached to the project as retrieved evidence. They are not treated as verified recommendations until you review the sources.`,
        "web-researched",
        citations,
      );
      persist(appendWorkspaceMessage(withFindings, researchMessage));
      setResearchState("idle");
    } catch {
      setResearchState("error");
      setResearchMessage("The research route could not be reached. No citations were added.");
    }
  }

  if (loadState === "loading") {
    return <main className="workspace-page workspace-centered-state"><div className="workspace-state-card"><span className="eyebrow">Medharya workspace</span><h1>Loading your project context…</h1><p>Reading the local project record. No cloud sync is being assumed.</p></div></main>;
  }

  if (loadState === "missing" || !workspace) {
    return <main className="workspace-page workspace-centered-state"><div className="workspace-state-card"><span className="eyebrow">Project not found</span><h1>This workspace is not available in this browser.</h1><p>The project may have been cleared, or this link may have been opened on another device. Start a new brief to create a local workspace.</p><Link className="button button-primary" href="/#builder">Create a new project <span aria-hidden="true">↗</span></Link></div></main>;
  }

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <div className="page-width workspace-header-inner">
          <Brand href="/" />
          <div className="workspace-header-project"><span>Project workspace</span><strong>{workspace.name}</strong></div>
          <Link className="workspace-back-link" href="/">Back to Medharya <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <main className="page-width workspace-main">
        <section className="workspace-hero" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow"><span className="eyebrow-pulse" aria-hidden="true" /> Context-aware project workspace</p>
            <h1 id="workspace-title">{workspace.name}</h1>
            <p className="workspace-hero-summary">{workspace.request.idea}</p>
          </div>
          <div className="workspace-hero-meta"><span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span><span>Updated {new Date(workspace.updatedAt).toLocaleDateString()}</span><span className="local-badge"><i aria-hidden="true" /> Saved in this browser</span></div>
        </section>

        <WorkspaceBriefEditor key={workspace.updatedAt} request={workspace.request} onSave={saveBriefChanges} />

        {persistenceError ? <p className="workspace-inline-error workspace-persistence-alert" role="alert">{persistenceError}</p> : null}

        <div className="workspace-grid">
          <div className="workspace-primary-column">
            <WorkspaceChat messages={workspace.messages} isSending={isSending} error={chatError} onSend={sendMessage} onRetry={retryState ? retryServerResponse : undefined} />
            <section className="workspace-memory-panel" aria-labelledby="memory-title">
              <div className="workspace-panel-heading"><div><p className="eyebrow">Structured memory</p><h2 id="memory-title">What this project currently knows.</h2></div><span className="memory-version">Plan v{workspace.memory.currentPlanVersion}</span></div>
              <div className="memory-grid">
                <div><h3>Confirmed requirements</h3>{workspace.memory.confirmedRequirements.length ? <ul>{workspace.memory.confirmedRequirements.slice(-6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing explicitly confirmed yet.</p>}</div>
                <div><h3>Open questions</h3>{workspace.memory.openQuestions.length ? <ul>{workspace.memory.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No open questions generated.</p>}</div>
                <div><h3>Confirmed decisions</h3>{workspace.memory.technologyDecisions.length ? <ul>{workspace.memory.technologyDecisions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No technology decisions have been confirmed yet.</p>}</div>
                <div><h3>Recent summary</h3><p>{workspace.memory.recentSummary}</p></div>
              </div>
            </section>
          </div>
          <WorkspacePlanPanel workspace={workspace} researchState={researchState} researchMessage={researchMessage} onResearch={researchDirection} />
        </div>
      </main>
    </div>
  );
}
