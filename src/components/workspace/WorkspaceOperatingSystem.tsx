"use client";

import { useMemo, useState, type FormEvent } from "react";

import type { ProjectWorkspace, WorkspaceMessage } from "@/types/workspace";
import type { ProjectOperatingSystem } from "@/types/operating-system";
import {
  addBranch,
  appendBranchMessage,
  connectBranches,
  createDiscoveryAnswer,
  createManualAutomationRun,
  createTaskDrafts,
  getSafeAutomationTemplates,
  updateTaskStatus,
} from "@/lib/operating-system";
import { createStableId } from "@/lib/workspace";

type WorkspaceOperatingSystemProps = {
  workspace: ProjectWorkspace;
  onChange: (workspace: ProjectWorkspace) => void;
};

function timestamp() {
  return new Date().toISOString();
}

function branchMessage(role: WorkspaceMessage["role"], content: string): WorkspaceMessage {
  return {
    id: createStableId("branch-message"),
    role,
    content,
    createdAt: timestamp(),
    source: role === "user" ? "user" : "deterministic-fallback",
  };
}

export function WorkspaceOperatingSystem({ workspace, onChange }: WorkspaceOperatingSystemProps) {
  const operatingSystem = workspace.operatingSystem as ProjectOperatingSystem;
  const [selectedBranchId, setSelectedBranchId] = useState(operatingSystem.branches[0]?.id ?? "");
  const [newBranchName, setNewBranchName] = useState("");
  const [branchMessageDraft, setBranchMessageDraft] = useState("");
  const [connectTargetId, setConnectTargetId] = useState(operatingSystem.branches[1]?.id ?? "");
  const [discoveryDraft, setDiscoveryDraft] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "draft" | "in-progress" | "blocked" | "done">("all");
  const [notice, setNotice] = useState<string | null>(null);

  const selectedBranch = operatingSystem.branches.find((branch) => branch.id === selectedBranchId) ?? operatingSystem.branches[0];
  const visibleTasks = useMemo(
    () => operatingSystem.tasks.filter((task) => taskFilter === "all" || task.status === taskFilter),
    [operatingSystem.tasks, taskFilter],
  );
  const firstQuestion = operatingSystem.discoveryQuestions.find((question) => question.status === "open");

  function commit(nextOperatingSystem: ProjectOperatingSystem, message?: string) {
    onChange({ ...workspace, operatingSystem: nextOperatingSystem, updatedAt: timestamp() });
    if (message) setNotice(message);
  }

  function handleAddBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newBranchName.trim()) return;
    const nextBranches = addBranch(operatingSystem.branches, {
      workspaceId: workspace.id,
      name: newBranchName,
      template: "development-architecture",
      provenance: "user",
      approvalStatus: "pending",
      timestamp: timestamp(),
    });
    const nextBranch = nextBranches[nextBranches.length - 1];
    commit({ ...operatingSystem, branches: nextBranches }, "Branch added as a reviewable project record.");
    setSelectedBranchId(nextBranch.id);
    setNewBranchName("");
  }

  function renameSelectedBranch() {
    if (!selectedBranch) return;
    const name = window.prompt("Rename this branch", selectedBranch.name)?.trim();
    if (!name) return;
    commit({
      ...operatingSystem,
      branches: operatingSystem.branches.map((branch) => branch.id === selectedBranch.id ? { ...branch, name, updatedAt: timestamp() } : branch),
    }, "Branch renamed.");
  }

  function archiveSelectedBranch() {
    if (!selectedBranch) return;
    commit({
      ...operatingSystem,
      branches: operatingSystem.branches.map((branch) => branch.id === selectedBranch.id ? { ...branch, status: branch.status === "active" ? "archived" : "active", updatedAt: timestamp() } : branch),
    }, selectedBranch.status === "active" ? "Branch archived; its records remain available." : "Branch reopened.");
  }

  function connectSelectedBranch() {
    if (!selectedBranch || !connectTargetId || connectTargetId === selectedBranch.id) return;
    const target = operatingSystem.branches.find((branch) => branch.id === connectTargetId);
    if (!target) return;
    commit({
      ...operatingSystem,
      edges: connectBranches(operatingSystem.edges, selectedBranch.id, target.id, "related-to", "Connected from the project idea map."),
    }, `Connected ${selectedBranch.name} to ${target.name}.`);
  }

  function sendBranchMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch || !branchMessageDraft.trim()) return;
    const userMessage = branchMessage("user", branchMessageDraft.trim());
    const assistantMessage = branchMessage(
      "assistant",
      `In the ${selectedBranch.name} branch, keep this connected to the shared project brief: “${workspace.request.idea}”. This branch response is a deterministic local fallback; use the main project chat for provider-backed discussion when configured.\n\nNext useful move: turn “${branchMessageDraft.trim().slice(0, 120)}” into a reviewable requirement or task rather than treating it as an approved decision.`,
    );
    let nextWorkspace = appendBranchMessage(workspace, selectedBranch.id, userMessage);
    nextWorkspace = appendBranchMessage(nextWorkspace, selectedBranch.id, assistantMessage);
    onChange(nextWorkspace);
    setBranchMessageDraft("");
  }

  function answerDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstQuestion || !discoveryDraft.trim()) return;
    const answer = createDiscoveryAnswer(firstQuestion, discoveryDraft);
    const nextQuestions = operatingSystem.discoveryQuestions.map((question) => question.id === firstQuestion.id ? { ...question, status: "answered" as const } : question);
    commit({
      ...operatingSystem,
      discoveryQuestions: nextQuestions,
      discoveryAnswers: [...operatingSystem.discoveryAnswers, answer],
    }, "Discovery answer recorded as a user-provided fact for review.");
    setDiscoveryDraft("");
  }

  function skipDiscovery() {
    if (!firstQuestion) return;
    commit({
      ...operatingSystem,
      discoveryQuestions: operatingSystem.discoveryQuestions.map((question) => question.id === firstQuestion.id ? { ...question, status: "skipped" as const } : question),
    }, "Discovery question skipped; it can be revisited after a brief change.");
    setDiscoveryDraft("");
  }

  function generateTasks() {
    const buildBranch = operatingSystem.branches.find((branch) => branch.template === "development-architecture") ?? operatingSystem.branches[0];
    if (!buildBranch) return;
    const drafts = createTaskDrafts(workspace.plan, {
      branchId: buildBranch.id,
      existingTasks: operatingSystem.tasks,
      approvalStatus: "pending",
      timestamp: timestamp(),
    });
    commit({
      ...operatingSystem,
      tasks: [...operatingSystem.tasks, ...drafts],
      branches: operatingSystem.branches.map((branch) => branch.id === buildBranch.id ? { ...branch, taskIds: [...branch.taskIds, ...drafts.map((task) => task.id)] } : branch),
    }, drafts.length ? `${drafts.length} task drafts prepared for approval.` : "No duplicate task drafts were created.");
  }

  function setTaskStatus(taskId: string, status: "draft" | "ready" | "in-progress" | "blocked" | "done" | "cancelled") {
    const result = updateTaskStatus(operatingSystem.tasks, taskId, status);
    commit({ ...operatingSystem, tasks: result.tasks }, result.reason);
  }

  function runAutomation(automationId: string) {
    const automation = operatingSystem.automations.find((item) => item.id === automationId) ?? getSafeAutomationTemplates().find((item) => item.id === automationId);
    if (!automation) return;
    const run = createManualAutomationRun(automation, ["No external side effect was requested.", "Any generated draft remains pending approval."]);
    commit({ ...operatingSystem, automationRuns: [...operatingSystem.automationRuns, run] }, run.summary);
  }

  return (
    <section className="workspace-os-panel" aria-labelledby="operating-system-title">
      <div className="workspace-panel-heading">
        <div>
          <p className="eyebrow">Idea operating system</p>
          <h2 id="operating-system-title">Branches, decisions, and execution.</h2>
        </div>
        <span className="memory-version">Local record · reviewable</span>
      </div>
      {notice ? <p className="workspace-os-notice" role="status">{notice}</p> : null}
      {operatingSystem.branchImpactSuggestions?.some((suggestion) => suggestion.impact !== "low") ? (
        <section className="os-impact-strip" aria-labelledby="branch-impact-title">
          <div className="os-section-heading"><div><h3 id="branch-impact-title">Change impact review</h3><p>A brief change can affect multiple branches. These are deterministic suggestions, not silent updates.</p></div><span>approval required</span></div>
          <div className="impact-list">{operatingSystem.branchImpactSuggestions.filter((suggestion) => suggestion.impact !== "low").map((suggestion) => <div className={`impact-item impact-${suggestion.impact}`} key={suggestion.branchId}><strong>{suggestion.branchName}</strong><span>{suggestion.impact}</span><p>{suggestion.reason} {suggestion.suggestedAction}</p></div>)}</div>
        </section>
      ) : null}

      <div className="os-grid">
        <section className="os-canvas-section" aria-labelledby="branch-map-title">
          <div className="os-section-heading"><div><h3 id="branch-map-title">Idea map</h3><p>Every node below is backed by the same project record used by chat and tasks.</p></div><span>{operatingSystem.branches.filter((branch) => branch.status === "active").length} active branches</span></div>
          <div className="branch-map" role="list" aria-label="Project branches">
            <div className="branch-root" role="listitem"><span className="branch-node-index">ROOT</span><strong>{workspace.name}</strong><small>Shared project context</small></div>
            {operatingSystem.branches.map((branch) => (
              <button type="button" role="listitem" className={`branch-node${selectedBranch?.id === branch.id ? " is-selected" : ""}${branch.status === "archived" ? " is-archived" : ""}`} key={branch.id} onClick={() => setSelectedBranchId(branch.id)}>
                <span className="branch-node-index">{branch.template}</span><strong>{branch.name}</strong><small>{branch.taskIds.length} tasks · {branch.messages.length} messages</small>
              </button>
            ))}
          </div>
          <div className="os-controls">
            <form onSubmit={handleAddBranch} className="inline-add-form"><label className="sr-only" htmlFor="new-branch-name">New branch name</label><input id="new-branch-name" value={newBranchName} maxLength={100} placeholder="Add a custom branch" onChange={(event) => setNewBranchName(event.target.value)} /><button className="button button-secondary button-small" type="submit" disabled={!newBranchName.trim()}>Add branch</button></form>
            <div className="selected-branch-actions"><span>{selectedBranch ? `Selected: ${selectedBranch.name}` : "Select a branch"}</span><button className="button button-ghost button-small" type="button" onClick={renameSelectedBranch} disabled={!selectedBranch}>Rename</button><button className="button button-ghost button-small" type="button" onClick={archiveSelectedBranch} disabled={!selectedBranch}>{selectedBranch?.status === "archived" ? "Reopen" : "Archive"}</button></div>
            <div className="selected-branch-actions"><label className="sr-only" htmlFor="connect-branch">Connect to branch</label><select id="connect-branch" value={connectTargetId} onChange={(event) => setConnectTargetId(event.target.value)}><option value="">Connect to…</option>{operatingSystem.branches.filter((branch) => branch.id !== selectedBranch?.id).map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><button className="button button-secondary button-small" type="button" onClick={connectSelectedBranch} disabled={!selectedBranch || !connectTargetId}>Connect branches</button></div>
          </div>
        </section>

        <section className="os-discovery-section" aria-labelledby="discovery-title">
          <div className="os-section-heading"><div><h3 id="discovery-title">Progressive discovery</h3><p>One question at a time; supplied brief fields are skipped.</p></div><span>{operatingSystem.discoveryAnswers.length} answers</span></div>
          {firstQuestion ? <form className="discovery-question-card" onSubmit={answerDiscovery}><span className="discovery-question-number">Next question</span><strong>{firstQuestion.prompt}</strong><p>{firstQuestion.rationale}</p><textarea value={discoveryDraft} rows={3} maxLength={1000} placeholder="Answer, or leave it until you are ready…" onChange={(event) => setDiscoveryDraft(event.target.value)} /><div><button className="button button-primary button-small" type="submit" disabled={!discoveryDraft.trim()}>Record answer</button><button className="button button-ghost button-small" type="button" onClick={skipDiscovery}>Skip for now</button></div></form> : <p className="os-empty-state">The current discovery questions are answered or skipped. You can revisit them after changing the brief.</p>}
        </section>
      </div>

      <section className="os-branch-chat" aria-labelledby="branch-chat-title">
        <div className="os-section-heading"><div><h3 id="branch-chat-title">{selectedBranch?.name ?? "Branch"} conversation</h3><p>Branch chat keeps its own messages while inheriting the shared project idea.</p></div><span>{selectedBranch?.approvalStatus ?? "pending"} review</span></div>
        <div className="branch-chat-history">{selectedBranch?.messages.slice(-5).map((message) => <article className={`branch-chat-message ${message.role}`} key={message.id}><small>{message.role === "user" ? "You" : "Medharya · branch fallback"}</small><p>{message.content}</p></article>)}</div>
        <form className="branch-chat-composer" onSubmit={sendBranchMessage}><label className="sr-only" htmlFor="branch-message">Message this branch</label><textarea id="branch-message" rows={2} value={branchMessageDraft} maxLength={2000} placeholder="Ask a question specific to this branch…" onChange={(event) => setBranchMessageDraft(event.target.value)} /><button className="button button-secondary button-small" type="submit" disabled={!branchMessageDraft.trim()}>Send to branch <span aria-hidden="true">↗</span></button></form>
      </section>

      <section className="os-execution-section" aria-labelledby="execution-title">
        <div className="os-section-heading"><div><h3 id="execution-title">Execution command center</h3><p>Generated work starts as drafts. Status changes are real records, not assistant claims.</p></div><button className="button button-secondary button-small" type="button" onClick={generateTasks}>Draft tasks from plan</button></div>
        <div className="task-toolbar"><label htmlFor="task-filter">Show <select id="task-filter" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value as typeof taskFilter)}><option value="all">all</option><option value="draft">draft</option><option value="in-progress">in progress</option><option value="blocked">blocked</option><option value="done">done</option></select></label><span>{operatingSystem.tasks.filter((task) => task.status === "done").length}/{operatingSystem.tasks.length} done</span></div>
        <div className="task-list">{visibleTasks.length ? visibleTasks.map((task) => <article className="task-card" key={task.id}><div><span className={`task-status task-status-${task.status}`}>{task.status}</span><h4>{task.title}</h4><p>{task.description}</p><small>{task.approvalStatus} approval · {task.acceptanceCriteria[0]}</small></div><select aria-label={`Update ${task.title} status`} value={task.status} onChange={(event) => setTaskStatus(task.id, event.target.value as typeof task.status)}><option value="draft">Draft</option><option value="ready">Ready</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></article>) : <p className="os-empty-state">No tasks match this filter.</p>}</div>
      </section>

      <section className="os-automation-section" aria-labelledby="automation-title">
        <div className="os-section-heading"><div><h3 id="automation-title">Automation studio</h3><p>Only manual dry runs are enabled in this prototype; no scheduler is implied.</p></div><span>{operatingSystem.automationRuns.length} runs</span></div>
        <div className="automation-list">{operatingSystem.automations.map((automation) => <article className="automation-card" key={automation.id}><div><strong>{automation.name}</strong><p>{automation.description}</p><small>Manual-only · approval required for side effects</small></div><button className="button button-secondary button-small" type="button" onClick={() => runAutomation(automation.id)} disabled={automation.status !== "available"}>Run dry check</button></article>)}</div>
        {operatingSystem.automationRuns.length ? <p className="automation-run-note" role="status">Last run: {operatingSystem.automationRuns[operatingSystem.automationRuns.length - 1].summary}</p> : null}
      </section>
    </section>
  );
}
