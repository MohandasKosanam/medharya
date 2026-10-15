import type { ProjectRequest } from "@/types/project";

type ProjectSummaryProps = {
  request: ProjectRequest;
  onEdit: () => void;
};

function formatBudget(budgetInr: number | null) {
  return budgetInr === null
    ? "Not specified"
    : `₹${new Intl.NumberFormat("en-IN").format(budgetInr)}`;
}

export function ProjectSummary({ request, onEdit }: ProjectSummaryProps) {
  return (
    <article
      className="request-summary"
      aria-labelledby="request-summary-title"
      tabIndex={-1}
    >
      <div className="summary-heading">
        <span className="summary-check" aria-hidden="true">
          ✓
        </span>
        <div>
          <p className="eyebrow eyebrow-success">Request captured</p>
          <h3 id="request-summary-title">Your project brief is ready.</h3>
        </div>
      </div>
      <p className="summary-intro">
        This is the structured brief Medharya will use for the project workspace.
        The workspace starts with a deterministic catalogue baseline; no live
        model or web research is claimed here.
      </p>

      <div className="summary-idea">
        <span className="summary-label">Project idea</span>
        <p>{request.idea}</p>
      </div>

      <dl className="summary-grid">
        <div>
          <dt>Category</dt>
          <dd>{request.category}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{formatBudget(request.budgetInr)}</dd>
        </div>
        <div>
          <dt>Experience</dt>
          <dd>{request.experienceLevel}</dd>
        </div>
        <div>
          <dt>Deployment</dt>
          <dd>{request.deploymentPreference}</dd>
        </div>
        <div className="summary-grid-wide">
          <dt>Preferred technologies</dt>
          <dd>
            {request.preferredTechnologies.length > 0
              ? request.preferredTechnologies.join(", ")
              : "No preference"}
          </dd>
        </div>
        {request.additionalRequirements ? (
          <div className="summary-grid-wide">
            <dt>Additional requirements</dt>
            <dd>{request.additionalRequirements}</dd>
          </div>
        ) : null}
      </dl>

      <div className="summary-actions">
        <p>
          Your editable draft stays in this browser only. Cloud saving and
          personalized model recommendations require explicit provider
          configuration.
        </p>
        <button className="button button-secondary" type="button" onClick={onEdit}>
          Edit this request
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}
