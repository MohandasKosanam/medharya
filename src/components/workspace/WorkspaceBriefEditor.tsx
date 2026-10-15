"use client";

import { useState, type FormEvent } from "react";

import {
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  TECHNOLOGY_OPTIONS,
  type ProjectDraft,
  type ProjectRequest,
} from "@/types/project";
import type { WorkspaceRequestPatch } from "@/types/workspace";
import {
  MAX_IDEA_LENGTH,
  MAX_REQUIREMENTS_LENGTH,
  validateProjectDraft,
} from "@/lib/validation";

type WorkspaceBriefEditorProps = {
  request: ProjectRequest;
  onSave: (patch: WorkspaceRequestPatch) => void;
};

const technologyOptions = TECHNOLOGY_OPTIONS.filter((technology) => technology !== "No preference");

export function WorkspaceBriefEditor({ request, onSave }: WorkspaceBriefEditorProps) {
  const [idea, setIdea] = useState(request.idea);
  const [category, setCategory] = useState(request.category);
  const [budgetInr, setBudgetInr] = useState(request.budgetInr === null ? "" : String(request.budgetInr));
  const [experienceLevel, setExperienceLevel] = useState(request.experienceLevel);
  const [preferredTechnologies, setPreferredTechnologies] = useState(request.preferredTechnologies);
  const [deploymentPreference, setDeploymentPreference] = useState(request.deploymentPreference);
  const [additionalRequirements, setAdditionalRequirements] = useState(request.additionalRequirements);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleTechnology(technology: string) {
    setSaved(false);
    setPreferredTechnologies((current) =>
      current.includes(technology)
        ? current.filter((item) => item !== technology)
        : [...current, technology],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft: ProjectDraft = {
      idea,
      category,
      budgetInr,
      experienceLevel,
      preferredTechnologies,
      noTechnologyPreference: preferredTechnologies.length === 0,
      deploymentPreference,
      additionalRequirements,
    };
    const errors = validateProjectDraft(draft);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setError(firstError);
      setSaved(false);
      return;
    }

    setError(null);
    setSaved(true);
    onSave({
      idea: idea.trim(),
      category,
      budgetInr: budgetInr.trim() ? Number(budgetInr) : null,
      experienceLevel,
      preferredTechnologies: preferredTechnologies.map((technology) => technology.trim()),
      deploymentPreference,
      additionalRequirements: additionalRequirements.trim(),
    });
  }

  return (
    <details className="workspace-brief-editor">
      <summary>
        <span>
          <strong>Edit project brief</strong>
          <small>Changes require an explicit save and regenerate the baseline plan.</small>
        </span>
        <span className="details-chevron" aria-hidden="true">⌄</span>
      </summary>
      <form onSubmit={handleSubmit}>
        <div className="workspace-editor-grid">
          <label className="workspace-editor-wide">
            Idea
            <textarea value={idea} maxLength={MAX_IDEA_LENGTH} rows={3} onChange={(event) => { setSaved(false); setIdea(event.target.value); }} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => { setSaved(false); setCategory(event.target.value as ProjectRequest["category"]); }}>
              {PROJECT_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Budget (INR)
            <input type="number" min="0" step="1" value={budgetInr} placeholder="Not specified" onChange={(event) => { setSaved(false); setBudgetInr(event.target.value); }} />
          </label>
          <label>
            Experience
            <select value={experienceLevel} onChange={(event) => { setSaved(false); setExperienceLevel(event.target.value as ProjectRequest["experienceLevel"]); }}>
              {EXPERIENCE_LEVELS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Deployment
            <select value={deploymentPreference} onChange={(event) => { setSaved(false); setDeploymentPreference(event.target.value as ProjectRequest["deploymentPreference"]); }}>
              {DEPLOYMENT_PREFERENCES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <fieldset className="workspace-editor-wide workspace-technology-fieldset">
            <legend>Preferred technologies</legend>
            <div className="workspace-technology-list">
              {technologyOptions.map((technology) => (
                <label key={technology} className={preferredTechnologies.includes(technology) ? "is-selected" : ""}>
                  <input type="checkbox" checked={preferredTechnologies.includes(technology)} onChange={() => toggleTechnology(technology)} />
                  {technology}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="workspace-editor-wide">
            Additional requirements
            <textarea value={additionalRequirements} maxLength={MAX_REQUIREMENTS_LENGTH} rows={3} onChange={(event) => { setSaved(false); setAdditionalRequirements(event.target.value); }} />
          </label>
        </div>
        {error ? <p className="workspace-inline-error" role="alert">{error}</p> : null}
        {saved ? <p className="workspace-inline-success" role="status">Brief saved. The plan below has been regenerated for review.</p> : null}
        <button className="button button-primary button-small" type="submit">Save and regenerate plan <span aria-hidden="true">↗</span></button>
      </form>
    </details>
  );
}
