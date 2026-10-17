"use client";

import type { ProjectWorkspace } from "@/types/workspace";

type WorkspacePlanPanelProps = {
  workspace: ProjectWorkspace;
  researchState: "idle" | "working" | "unavailable" | "error";
  researchMessage: string | null;
  onResearch: () => void;
};

export function WorkspacePlanPanel({ workspace, researchState, researchMessage, onResearch }: WorkspacePlanPanelProps) {
  const { plan } = workspace;
  const researchEvidence = workspace.researchEvidence ?? [];
  const researchClaims = workspace.researchClaims ?? [];
  const researchAssessment = workspace.researchAssessment;
  return (
    <aside className="workspace-plan-panel" aria-labelledby="workspace-plan-title">
      <div className="workspace-plan-header">
        <div>
          <p className="eyebrow">Current direction · v{plan.version}</p>
          <h2 id="workspace-plan-title">Solution plan</h2>
        </div>
        <span className="plan-provenance">{plan.provenance === "deterministic-catalogue" ? "Catalogue baseline" : plan.provenance}</span>
      </div>
      <p className="plan-summary">{plan.summary}</p>

      <section className="plan-subsection">
        <div className="plan-subsection-heading"><h3>Recommended stack</h3><span>{plan.stack.length} tools</span></div>
        <div className="plan-stack-list">
          {plan.stack.map((item) => (
            <article className="plan-stack-item" key={item.toolId}>
              <div className="plan-stack-item-topline"><strong>{item.toolName}</strong><span>{item.category}</span></div>
              <p>{item.reason}</p>
              <small>{item.confidence} confidence · {item.tradeoffs[0]}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="plan-subsection">
        <div className="plan-subsection-heading"><h3>Implementation roadmap</h3><span>{plan.roadmap.length} steps</span></div>
        <ol className="workspace-roadmap">
          {plan.roadmap.map((step) => <li key={step.order}><span>{String(step.order).padStart(2, "0")}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}
        </ol>
      </section>

      <section className="plan-subsection compact-plan-section">
        <div className="plan-subsection-heading"><h3>Trade-offs & alternatives</h3></div>
        {plan.alternatives.length ? <ul className="plan-bullet-list">{plan.alternatives.map((alternative) => <li key={alternative.toolId}><strong>{alternative.toolName}</strong> — {alternative.tradeoff}</li>)}</ul> : <p className="plan-muted">No direct alternative was selected by the baseline rules.</p>}
      </section>

      <section className="plan-subsection compact-plan-section">
        <div className="plan-subsection-heading"><h3>Budget signals</h3></div>
        <p className="plan-budget-value">{plan.budget.budgetInr === null ? "Budget not specified" : `₹${new Intl.NumberFormat("en-IN").format(plan.budget.budgetInr)} constraint`}</p>
        <ul className="plan-bullet-list">{plan.budget.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </section>

      <section className="research-card">
        <div className="plan-subsection-heading"><div><h3>Research evidence</h3><span>{researchEvidence.length ? `${researchEvidence.length} evidence records` : "None attached"}</span></div><span className="research-status-dot" aria-hidden="true" /></div>
        <p>{researchMessage ?? "Live search is opt-in. Search snippets and retrieved pages are source-backed evidence, not human verification."}</p>
        <button className="button button-secondary button-small" type="button" onClick={onResearch} disabled={researchState === "working"}>
          {researchState === "working" ? "Researching…" : "Research this direction"}
          {researchState !== "working" ? <span aria-hidden="true">↗</span> : null}
        </button>
        {workspace.researchFindings.length ? <div className="research-results">{workspace.researchFindings.slice(-4).map((finding) => <a href={finding.url} target="_blank" rel="noreferrer" key={finding.id}><strong>{finding.title}</strong><small>{finding.snippet || finding.url}</small><span>{finding.pageRetrieved ? "public page retrieved" : "search snippet only"} · {finding.verificationStatus} · {new Date(finding.retrievedAt).toLocaleDateString()}</span>{finding.retrievalError ? <em>{finding.retrievalError}</em> : null}</a>)}</div> : null}
        {researchClaims.length ? <div className="research-claims"><strong>Evidence-backed claims</strong><ul>{researchClaims.slice(-4).map((claim) => <li key={claim.id}><span>{claim.supportStatus}</span> {claim.text}</li>)}</ul></div> : null}
        {researchAssessment?.evidenceGaps.length ? <div className="research-claims"><strong>Evidence gaps</strong><ul>{researchAssessment.evidenceGaps.slice(0, 4).map((gap) => <li key={gap}>{gap}</li>)}</ul></div> : null}
        {researchAssessment?.contradictions.length ? <div className="research-claims"><strong>Potential conflicts</strong><ul>{researchAssessment.contradictions.slice(0, 3).map((item) => <li key={item.id}>{item.summary}</li>)}</ul></div> : null}
      </section>

      <section className="plan-subsection compact-plan-section">
        <div className="plan-subsection-heading"><h3>Open questions</h3><span>{plan.openQuestions.length}</span></div>
        {plan.openQuestions.length ? <ul className="plan-bullet-list">{plan.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul> : <p className="plan-muted">No additional questions were generated by the baseline rules.</p>}
      </section>

      <details className="plan-sources">
        <summary>Catalogue sources and verification</summary>
        <p>These are curated official links. They are not live-verified in this environment and do not establish current pricing or compatibility.</p>
        <ul>{plan.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul>
      </details>
    </aside>
  );
}
