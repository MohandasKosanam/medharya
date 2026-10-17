"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Brand } from "@/components/layout/Brand";
import type { ResearchResponse } from "@/types/research";
import type { ModelProviderStatus } from "@/lib/providers/types";
import type { WorkspaceMessage, ProjectWorkspace, WorkspaceRequestPatch } from "@/types/workspace";
import { appendResearchBundle, appendWorkspaceMessage, applyWorkspaceRequestPatch, createStableId } from "@/lib/workspace";
import { appendBranchMessage, ensureOperatingSystem } from "@/lib/operating-system";
import { generateDeterministicAssistantReply } from "@/lib/assistant";
import { loadProjectWorkspace, saveProjectWorkspace } from "@/lib/workspace-storage";
import { detectResearchIntent } from "@/lib/research/intent";

import { WorkspaceBriefEditor } from "./WorkspaceBriefEditor";
import { WorkspaceChat } from "./WorkspaceChat";
import { WorkspacePlanPanel } from "./WorkspacePlanPanel";
import { WorkspaceOperatingSystem } from "./WorkspaceOperatingSystem";
import { WorkspaceAccountStatus } from "./WorkspaceAccountStatus";

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

function workspaceTimestamp(workspace: ProjectWorkspace) {
  const value = Date.parse(workspace.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function freshestWorkspace(left: ProjectWorkspace, right: ProjectWorkspace) {
  return workspaceTimestamp(right) >= workspaceTimestamp(left) ? right : left;
}

type ResearchPayload = Partial<ResearchResponse> & { error?: string; workspace?: unknown };

function researchPayloadMessage(payload: ResearchPayload) {
  return typeof payload.message === "string" && payload.message
    ? payload.message
    : typeof payload.error === "string" && payload.error
      ? payload.error
      : "Live research was not available.";
}

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const workspaceRef = useRef<ProjectWorkspace | null>(null);
  const operatingSystemSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [loadState, setLoadState] = useState<WorkspaceState>("loading");
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<{ workspace: ProjectWorkspace; content: string; messageId: string; serverBacked: boolean } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [serverBacked, setServerBacked] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{ projectId: string; status: ModelProviderStatus } | null>(null);
  const [researchState, setResearchState] = useState<"idle" | "working" | "unavailable" | "error">("idle");
  const [researchMessage, setResearchMessage] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        const savedWorkspace = loadProjectWorkspace(projectId);
        const localWorkspace = savedWorkspace ? ensureOperatingSystem(savedWorkspace) : null;
        const hasLocalWorkspace = Boolean(savedWorkspace);
        if (!active) return;
        if (localWorkspace) {
          workspaceRef.current = localWorkspace;
          setWorkspace(localWorkspace);
          setLoadState("ready");
        }

        try {
          const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
          const payload: unknown = await response.json();
          if (!active) return;
          if (response.ok && typeof payload === "object" && payload !== null && "project" in payload && payload.project) {
            const serverWorkspace = ensureOperatingSystem(payload.project as ProjectWorkspace);
            const nextWorkspace = localWorkspace
              ? freshestWorkspace(localWorkspace, serverWorkspace)
              : serverWorkspace;
            saveProjectWorkspace(nextWorkspace);
            workspaceRef.current = nextWorkspace;
            setWorkspace(nextWorkspace);
            setServerBacked(true);
            setLoadState("ready");
            if (localWorkspace && workspaceTimestamp(localWorkspace) > workspaceTimestamp(serverWorkspace)) {
              setSyncNotice("The browser cache is newer than the last server snapshot, so the newer local record is being kept.");
            } else {
              setSyncNotice(null);
            }
            return;
          }
        } catch {
          // The local-first fallback below remains the honest state when the server is unavailable.
        }
        if (!active) return;
        setServerBacked(false);
        if (!hasLocalWorkspace) setLoadState("missing");
      })();
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [projectId]);

  useEffect(() => {
    if (!serverBacked) {
      return;
    }
    let active = true;
    void fetch(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`)
      .then(async (response) => {
        const payload = await readResponse(response);
        if (!active || !response.ok || typeof payload.providerStatus !== "object" || payload.providerStatus === null) return;
        setProviderStatus({ projectId, status: payload.providerStatus as ModelProviderStatus });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId, serverBacked]);

  function persist(nextWorkspace: ProjectWorkspace) {
    const normalizedWorkspace = ensureOperatingSystem(nextWorkspace);
    workspaceRef.current = normalizedWorkspace;
    setWorkspace(normalizedWorkspace);
    if (!saveProjectWorkspace(normalizedWorkspace)) {
      setPersistenceError("The workspace is visible, but this browser could not persist the latest change.");
    } else {
      setPersistenceError(null);
    }
  }

  function persistOperatingSystem(nextWorkspace: ProjectWorkspace) {
    const normalizedWorkspace = ensureOperatingSystem(nextWorkspace);
    const latestWorkspace = workspaceRef.current;
    const reconciledWorkspace = latestWorkspace ? freshestWorkspace(latestWorkspace, normalizedWorkspace) : normalizedWorkspace;
    const previousBranchIds = new Set(latestWorkspace?.operatingSystem?.branches.map((branch) => branch.id) ?? []);
    const nextBranchIds = new Set(reconciledWorkspace.operatingSystem?.branches.map((branch) => branch.id) ?? []);
    const deletedBranchIds = [...previousBranchIds].filter((branchId) => !nextBranchIds.has(branchId));
    persist(reconciledWorkspace);
    if (!serverBacked) return;
    const syncRequest = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/operating-system`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatingSystem: reconciledWorkspace.operatingSystem, ...(deletedBranchIds.length ? { deletedBranchIds } : {}) }),
        });
        const payload = await readResponse(response);
        if (!response.ok) {
          setSyncNotice("The latest branch change is saved in this browser, but the server could not confirm it.");
          return;
        }
        if (payload.project && typeof payload.project === "object") {
          const serverWorkspace = ensureOperatingSystem(payload.project as ProjectWorkspace);
          const currentWorkspace = workspaceRef.current;
          persist(currentWorkspace ? freshestWorkspace(currentWorkspace, serverWorkspace) : serverWorkspace);
        }
        setSyncNotice(null);
      } catch {
        setSyncNotice("The latest branch change is saved in this browser, but the server could not be reached.");
      }
    };
    operatingSystemSyncQueueRef.current = operatingSystemSyncQueueRef.current
      .catch(() => undefined)
      .then(syncRequest);
  }

  async function researchChatMessage(baseWorkspace: ProjectWorkspace, content: string) {
    const intent = detectResearchIntent(content);
    if (!intent.shouldResearch || serverBacked) {
      return { workspace: baseWorkspace, notice: null as string | null };
    }

    setResearchState("working");
    setResearchMessage(`Checking current sources because this looks like a ${intent.intent.replace("-", " ")} question…`);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverBacked ? { projectId, query: content } : { query: content }),
      });
      const payload = await readResponse(response) as unknown as ResearchPayload;
      const message = researchPayloadMessage(payload);
      const evidenceCount = Array.isArray(payload.evidence) ? payload.evidence.length : 0;
      const citationCount = Array.isArray(payload.citations) ? payload.citations.length : 0;

      if (!response.ok || payload.status === "unavailable" || payload.status === "error") {
        setResearchState(payload.status === "unavailable" ? "unavailable" : "error");
        setResearchMessage(`${message} Chat will continue without external evidence.`);
        return {
          workspace: baseWorkspace,
          notice: `Automatic research was requested but unavailable (${intent.intent}); chat continued without external evidence.`,
        };
      }

      const gapNote = payload.assessment?.evidenceGaps?.length ? ` Evidence gap: ${payload.assessment.evidenceGaps[0]}` : "";
      const conflictNote = payload.assessment?.contradictions?.length ? ` ${payload.assessment.contradictions.length} potentially conflicting evidence pair${payload.assessment.contradictions.length === 1 ? "" : "s"} require review.` : "";
      const resultNotice = `Automatic ${intent.intent.replace("-", " ")} research attached ${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"} and ${citationCount} citation${citationCount === 1 ? "" : "s"}. Results are source-backed, not human verification.${gapNote}${conflictNote}`;
      setResearchMessage(`${message} ${resultNotice}`);
      setResearchState("idle");

      if (serverBacked && payload.workspace && typeof payload.workspace === "object") {
        return {
          workspace: freshestWorkspace(baseWorkspace, ensureOperatingSystem(payload.workspace as ProjectWorkspace)),
          notice: resultNotice,
        };
      }

      const findings = Array.isArray(payload.findings) ? payload.findings : [];
      if (!findings.length) return { workspace: baseWorkspace, notice: resultNotice };

      const withFindings = appendResearchBundle(baseWorkspace, {
        findings,
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
        claims: Array.isArray(payload.claims) ? payload.claims : [],
        assessment: payload.assessment,
      });
      const citations = Array.isArray(payload.citations) ? payload.citations : [];
      const researchMessage = makeMessage(
        "assistant",
        `${typeof payload.summary === "string" ? payload.summary : message}\n\n${resultNotice}`,
        "web-researched",
        citations,
      );
      return { workspace: appendWorkspaceMessage(withFindings, researchMessage), notice: resultNotice };
    } catch {
      setResearchState("error");
      setResearchMessage("The automatic research route could not be reached. Chat will continue without external evidence.");
      return {
        workspace: baseWorkspace,
        notice: "Automatic research could not be reached; chat continued without external evidence.",
      };
    }
  }

  async function sendMessage(content: string) {
    const currentWorkspace = workspaceRef.current ?? workspace;
    if (!currentWorkspace || isSending) return;
    setIsSending(true);
    setChatError(null);
    setChatNotice(null);
    if (serverBacked && providerStatus?.projectId === projectId && providerStatus.status.provider === "medharya-alpha") {
      setProviderStatus({
        projectId,
        status: { ...providerStatus.status, state: "connecting", reason: undefined },
      });
    }

    const researchResult = await researchChatMessage(currentWorkspace, content);
    const userMessage = makeMessage("user", content, "user");
    const workspaceWithUserMessage = appendWorkspaceMessage(researchResult.workspace, userMessage);
    if (!serverBacked) persist(workspaceWithUserMessage);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverBacked
          ? { projectId, message: content, messageId: userMessage.id }
          : { workspace: workspaceWithUserMessage, message: content }),
      });
      const payload = await readResponse(response);
      if (!response.ok || typeof payload.content !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "The chat service returned an invalid response.");
      }
      if (typeof payload.providerStatus === "object" && payload.providerStatus !== null) {
        setProviderStatus({ projectId, status: payload.providerStatus as ModelProviderStatus });
      }

      if (serverBacked && payload.workspace && typeof payload.workspace === "object") {
        persist(freshestWorkspace(workspaceWithUserMessage, ensureOperatingSystem(payload.workspace as ProjectWorkspace)));
        const notices = [researchResult.notice, typeof payload.notice === "string" ? payload.notice : ""].filter(Boolean);
        if (notices.length) setChatNotice(notices.join(" "));
      } else {
        const source: WorkspaceMessage["source"] = payload.source === "model-assisted" ? "model-assisted" : "deterministic-fallback";
        const responseNotes = [
          researchResult.notice ?? "",
          typeof payload.notice === "string" && payload.notice ? `Source note: ${payload.notice}` : "",
          serverBacked ? "Persistence note: the server response did not include an updated workspace, so this copy is cached locally." : "",
        ].filter(Boolean);
        const notice = responseNotes.length ? `\n\n${responseNotes.join("\n")}` : "";
        if (serverBacked) setChatNotice("The server returned a response without an updated workspace; this copy is cached locally.");
        persist(appendWorkspaceMessage(workspaceWithUserMessage, makeMessage("assistant", `${payload.content}${notice}`, source)));
      }
      setRetryState(null);
    } catch (error) {
      const fallback = generateDeterministicAssistantReply(workspaceWithUserMessage, content);
      persist(appendWorkspaceMessage(workspaceWithUserMessage, makeMessage("assistant", `${fallback.content}\n\nSource note: The server chat route was unavailable, so this response was generated locally from the deterministic catalogue fallback.`, "deterministic-fallback")));
      if (serverBacked && providerStatus?.projectId === projectId && providerStatus.status.provider === "medharya-alpha") {
        setProviderStatus({ projectId, status: { ...providerStatus.status, state: "degraded", reason: "transient-error" } });
      }
      setChatError(error instanceof Error ? `${error.message} Local fallback used.` : "The server chat route was unavailable. Local fallback used.");
      setRetryState({ workspace: workspaceWithUserMessage, content, messageId: userMessage.id, serverBacked });
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
        body: JSON.stringify(retryState.serverBacked
          ? { projectId, message: retryState.content, messageId: retryState.messageId }
          : { workspace: retryState.workspace, message: retryState.content }),
      });
      const payload = await readResponse(response);
      if (!response.ok || typeof payload.content !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "The chat service returned an invalid response.");
      }
      if (typeof payload.providerStatus === "object" && payload.providerStatus !== null) {
        setProviderStatus({ projectId, status: payload.providerStatus as ModelProviderStatus });
      }
      if (retryState.serverBacked && payload.workspace && typeof payload.workspace === "object") {
        persist(freshestWorkspace(retryState.workspace, ensureOperatingSystem(payload.workspace as ProjectWorkspace)));
        if (typeof payload.notice === "string" && payload.notice) setChatNotice(payload.notice);
      } else {
        const source: WorkspaceMessage["source"] = payload.source === "model-assisted" ? "model-assisted" : "deterministic-fallback";
        const responseNotes = [
          typeof payload.notice === "string" && payload.notice ? `Source note: ${payload.notice}` : "",
          retryState.serverBacked ? "Persistence note: the server response did not include an updated workspace, so this copy is cached locally." : "",
        ].filter(Boolean);
        const notice = responseNotes.length ? `\n\n${responseNotes.join("\n")}` : "";
        if (retryState.serverBacked) setChatNotice("The server returned a response without an updated workspace; this copy is cached locally.");
        persist(appendWorkspaceMessage(retryState.workspace, makeMessage("assistant", `${payload.content}${notice}`, source)));
      }
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
    const nextWorkspace = appendWorkspaceMessage(updatedWorkspace, changeMessage);
    persist(nextWorkspace);
    setResearchMessage("The brief changed. Existing research evidence remains attached until you run a new direction-specific search.");
    if (!serverBacked) return;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch }),
    }).then(async (response) => {
      const payload = await readResponse(response);
      if (!response.ok) {
        setSyncNotice("The brief is saved in this browser, but the server could not confirm the latest edit.");
        return;
      }
      if (payload.project && typeof payload.project === "object") {
        persist(freshestWorkspace(nextWorkspace, ensureOperatingSystem(payload.project as ProjectWorkspace)));
      }
      setSyncNotice(null);
    }).catch(() => {
      setSyncNotice("The brief is saved in this browser, but the server could not be reached.");
    });
  }

  async function researchDirection() {
    const currentWorkspace = workspaceRef.current ?? workspace;
    if (!currentWorkspace || researchState === "working") return;
    setResearchState("working");
    const branch = selectedBranchId
      ? currentWorkspace.operatingSystem?.branches.find((candidate) => candidate.id === selectedBranchId)
      : undefined;
    const branchId = branch?.id;
    setResearchMessage(`Preparing a focused query${branch ? ` for ${branch.name}` : ""} from the current brief and selected stack…`);

    const query = `${currentWorkspace.request.idea} ${branch?.name ?? ""} official documentation ${currentWorkspace.plan.stack.slice(0, 4).map((item) => item.toolName).join(" ")}`.slice(0, 300);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverBacked ? { projectId, query, ...(branchId ? { branchId } : {}) } : { query, ...(branchId ? { branchId } : {}) }),
      });
      const payload = await readResponse(response) as unknown as Partial<ResearchResponse> & { error?: string; workspace?: unknown };
      const message = typeof payload.message === "string" ? payload.message : payload.error ?? "Research was not available.";
      const evidenceCount = Array.isArray(payload.evidence) ? payload.evidence.length : 0;
      const citationCount = Array.isArray(payload.citations) ? payload.citations.length : 0;
      const gapNote = payload.assessment?.evidenceGaps?.length ? ` Evidence gap: ${payload.assessment.evidenceGaps[0]}` : "";
      const conflictNote = payload.assessment?.contradictions?.length ? ` ${payload.assessment.contradictions.length} potentially conflicting evidence pair${payload.assessment.contradictions.length === 1 ? "" : "s"} require review.` : "";
      setResearchMessage(`${branch ? `${branch.name}: ` : ""}${message} ${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"} and ${citationCount} citation${citationCount === 1 ? "" : "s"} returned; source-backed results are not human verification.${gapNote}${conflictNote}`);
      if (!response.ok || payload.status === "unavailable") {
        setResearchState(payload.status === "unavailable" ? "unavailable" : "error");
        return;
      }

      const findings = Array.isArray(payload.findings) ? payload.findings : [];
      if (!findings.length) {
        setResearchState("idle");
        return;
      }

      const citations = Array.isArray(payload.citations) ? payload.citations : findings.slice(0, 5).map((finding) => ({
        title: finding.title,
        url: finding.url,
        retrievedAt: finding.retrievedAt,
      }));
      if (serverBacked && payload.workspace && typeof payload.workspace === "object") {
        persist(freshestWorkspace(currentWorkspace, ensureOperatingSystem(payload.workspace as ProjectWorkspace)));
        setResearchState("idle");
        return;
      }
      const withFindings = appendResearchBundle(currentWorkspace, {
        findings,
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
        claims: Array.isArray(payload.claims) ? payload.claims : [],
        assessment: payload.assessment,
      });
      const researchMessage = makeMessage(
        "assistant",
        `${typeof payload.summary === "string" ? payload.summary : message}\n\nThese results are attached to the project as source-backed evidence. They are not treated as verified recommendations until you review the sources.`,
        "web-researched",
        citations,
      );
      const withBranchReferences = branchId && withFindings.operatingSystem
        ? {
            ...withFindings,
            operatingSystem: {
              ...withFindings.operatingSystem,
              branches: withFindings.operatingSystem.branches.map((candidate) => candidate.id === branchId
                ? { ...candidate, researchFindingIds: [...new Set([...candidate.researchFindingIds, ...findings.map((finding) => finding.id)])], updatedAt: withFindings.updatedAt }
                : candidate),
            },
          }
        : withFindings;
      persist(branchId ? appendBranchMessage(withBranchReferences, branchId, researchMessage) : appendWorkspaceMessage(withBranchReferences, researchMessage));
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
          <WorkspaceAccountStatus />
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
          <div className="workspace-hero-meta"><span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span><span>Updated {new Date(workspace.updatedAt).toLocaleDateString()}</span><span className="local-badge"><i aria-hidden="true" /> {serverBacked ? "Server-owned + browser cache" : "Saved in this browser"}</span></div>
        </section>

        <WorkspaceBriefEditor key={workspace.updatedAt} request={workspace.request} onSave={saveBriefChanges} />

        {persistenceError ? <p className="workspace-inline-error workspace-persistence-alert" role="alert">{persistenceError}</p> : null}
        {syncNotice ? <p className="workspace-inline-note workspace-sync-note" role="status">{syncNotice}</p> : null}

        <div className="workspace-grid">
          <div className="workspace-primary-column">
            <WorkspaceChat messages={workspace.messages} isSending={isSending} error={chatError} notice={chatNotice} providerStatus={serverBacked && providerStatus?.projectId === projectId ? providerStatus.status : null} onSend={sendMessage} onRetry={retryState ? retryServerResponse : undefined} />
            <section className="workspace-memory-panel" aria-labelledby="memory-title">
              <div className="workspace-panel-heading"><div><p className="eyebrow">Structured memory</p><h2 id="memory-title">What this project currently knows.</h2></div><span className="memory-version">Plan v{workspace.memory.currentPlanVersion}</span></div>
              <div className="memory-grid">
                <div><h3>Confirmed requirements</h3>{workspace.memory.confirmedRequirements.length ? <ul>{workspace.memory.confirmedRequirements.slice(-6).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing explicitly confirmed yet.</p>}</div>
                <div><h3>Open questions</h3>{workspace.memory.openQuestions.length ? <ul>{workspace.memory.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No open questions generated.</p>}</div>
                <div><h3>Confirmed decisions</h3>{workspace.memory.technologyDecisions.length ? <ul>{workspace.memory.technologyDecisions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No technology decisions have been confirmed yet.</p>}</div>
                <div><h3>Recent summary</h3><p>{workspace.memory.recentSummary}</p></div>
              </div>
            </section>
            <WorkspaceOperatingSystem projectId={projectId} serverBacked={serverBacked} workspace={workspace} onChange={persistOperatingSystem} onSelectedBranchChange={setSelectedBranchId} />
          </div>
          <WorkspacePlanPanel workspace={workspace} researchState={researchState} researchMessage={researchMessage} onResearch={researchDirection} />
        </div>
      </main>
    </div>
  );
}
