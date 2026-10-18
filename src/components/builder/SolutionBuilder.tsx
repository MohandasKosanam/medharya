"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  TECHNOLOGY_OPTIONS,
  type ProjectDraft,
  type ProjectRequest,
} from "@/types/project";
import type { ProjectWorkspace } from "@/types/workspace";
import {
  createProjectRequest,
  hasProjectDraftErrors,
  MAX_IDEA_LENGTH,
  MAX_REQUIREMENTS_LENGTH,
  MAX_TECHNOLOGIES,
  type ProjectDraftErrors,
  validateProjectDraft,
} from "@/lib/validation";
import {
  clearAnonymousDraftId,
  clearProjectDraft,
  getDefaultProjectDraft,
  loadProjectDraft,
  saveProjectDraft,
} from "@/lib/storage";
import { createProjectWorkspace } from "@/lib/workspace";
import { saveProjectWorkspace } from "@/lib/workspace-storage";

import { AuthGate } from "@/components/auth/AuthGate";
import { ProjectSummary } from "./ProjectSummary";

const FIELD_IDS = {
  idea: "project-idea",
  category: "project-category",
  budgetInr: "project-budget",
  experienceLevel: "experience-level",
  preferredTechnologies: "preferred-technologies",
  deploymentPreference: "deployment-preference",
  additionalRequirements: "additional-requirements",
} as const;

const FIELD_FOCUS_TARGETS: Record<keyof typeof FIELD_IDS, string> = {
  idea: `#${FIELD_IDS.idea}`,
  category: 'input[name="project-category"]',
  budgetInr: `#${FIELD_IDS.budgetInr}`,
  experienceLevel: 'input[name="experience-level"]',
  preferredTechnologies: `#${FIELD_IDS.preferredTechnologies} button`,
  deploymentPreference: 'input[name="deployment-preference"]',
  additionalRequirements: `#${FIELD_IDS.additionalRequirements}`,
};

const technologyOptions = TECHNOLOGY_OPTIONS.filter(
  (technology) => technology !== "No preference",
);

type SaveState = "idle" | "saved" | "unavailable";

function getOptionClass(isSelected: boolean) {
  return `choice-card${isSelected ? " is-selected" : ""}`;
}

export function SolutionBuilder() {
  const [draft, setDraft] = useState<ProjectDraft>(() => getDefaultProjectDraft());
  const [touched, setTouched] = useState<Set<keyof ProjectDraftErrors>>(
    () => new Set(),
  );
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [submittedRequest, setSubmittedRequest] =
    useState<ProjectRequest | null>(null);
  const [customTechnology, setCustomTechnology] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const submissionInFlightRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const validationErrors = validateProjectDraft(draft);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedDraft = loadProjectDraft();
      if (savedDraft) setDraft(savedDraft);
      setHasHydratedDraft(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hasHydratedDraft) return;

    const saved = saveProjectDraft(draft);
    const frame = window.requestAnimationFrame(() => {
      setSaveState(saved ? "saved" : "unavailable");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [draft, hasHydratedDraft]);

  function updateDraft<K extends keyof ProjectDraft>(
    field: K,
    value: ProjectDraft[K],
  ) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  }

  function markTouched(field: keyof ProjectDraftErrors) {
    setTouched((currentTouched) => {
      const nextTouched = new Set(currentTouched);
      nextTouched.add(field);
      return nextTouched;
    });
  }

  function getError(field: keyof ProjectDraftErrors) {
    return (showAllErrors || touched.has(field)) && validationErrors[field]
      ? validationErrors[field]
      : undefined;
  }

  function setTechnologyPreference(technology: string) {
    const isSelected = draft.preferredTechnologies.includes(technology);
    const nextTechnologies = isSelected
      ? draft.preferredTechnologies.filter((item) => item !== technology)
      : [...draft.preferredTechnologies, technology];

    updateDraft("preferredTechnologies", nextTechnologies);
    updateDraft("noTechnologyPreference", false);
    markTouched("preferredTechnologies");
  }

  function useNoTechnologyPreference() {
    updateDraft("preferredTechnologies", []);
    updateDraft("noTechnologyPreference", true);
    markTouched("preferredTechnologies");
  }

  function addCustomTechnology() {
    const technology = customTechnology.trim();
    if (
      !technology ||
      draft.preferredTechnologies.length >= MAX_TECHNOLOGIES ||
      draft.preferredTechnologies.some(
        (item) => item.toLocaleLowerCase() === technology.toLocaleLowerCase(),
      )
    ) return;

    updateDraft("preferredTechnologies", [
      ...draft.preferredTechnologies,
      technology,
    ]);
    updateDraft("noTechnologyPreference", false);
    setCustomTechnology("");
    markTouched("preferredTechnologies");
  }

  function handleTechnologyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTechnology();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;
    const nextErrors = validationErrors;
    setShowAllErrors(true);

    if (hasProjectDraftErrors(nextErrors)) {
      const firstInvalidField = Object.keys(nextErrors)[0] as
        | keyof typeof FIELD_IDS
        | undefined;
      if (firstInvalidField) {
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(FIELD_FOCUS_TARGETS[firstInvalidField])
            ?.focus();
        });
      }
      return;
    }

    const request = createProjectRequest(draft);
    submissionInFlightRef.current = true;
    setIsCreatingWorkspace(true);
    setWorkspaceError(null);

    try {
      const response = await fetch("/api/auth/anonymous-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload: unknown = await response.json();
      const record = typeof payload === "object" && payload !== null
        ? payload as Record<string, unknown>
        : {};
      if (!response.ok || !record.draft || typeof record.draft !== "object") {
        const message = typeof record.error === "string"
          ? record.error
          : "The project draft could not be saved for account handoff.";
        throw new Error(message);
      }

      const draftRecord = record.draft as { id?: unknown };
      if (record.project && typeof record.project === "object") {
        openWorkspace(record.project as ProjectWorkspace);
        return;
      }
      if (typeof draftRecord.id !== "string") {
        throw new Error("The server returned an invalid draft id.");
      }

      setShowAuthGate(true);
      setSubmittedRequest(request);
      setIsCreatingWorkspace(false);
    } catch (error) {
      setIsCreatingWorkspace(false);
      setWorkspaceError(
        error instanceof Error
          ? `${error.message} You can still continue locally.`
          : "The account handoff was unavailable. You can still continue locally.",
      );
      setSubmittedRequest(request);
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  function openWorkspace(workspace: ProjectWorkspace) {
    if (!saveProjectWorkspace(workspace)) {
      setWorkspaceError(
        "The project was created, but this browser could not cache the workspace for offline viewing.",
      );
    }
    clearProjectDraft();
    clearAnonymousDraftId();
    setShowAuthGate(false);
    setIsCreatingWorkspace(false);
    router.push(`/workspace/${workspace.id}`);
  }

  function continueLocally() {
    const request = submittedRequest ?? createProjectRequest(draft);
    const workspace = createProjectWorkspace(request);
    if (!saveProjectWorkspace(workspace)) {
      setWorkspaceError(
        "This browser could not save the local workspace. Check local storage permissions and try again.",
      );
      setShowAuthGate(false);
      setIsCreatingWorkspace(false);
      return;
    }
    clearProjectDraft();
    clearAnonymousDraftId();
    setShowAuthGate(false);
    setIsCreatingWorkspace(false);
    router.push(`/workspace/${workspace.id}`);
  }

  function handleEditRequest() {
    setSubmittedRequest(null);
    window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>("#project-idea")?.focus();
    });
  }

  function handleClearDraft() {
    if (submissionInFlightRef.current) return;
    if (!window.confirm("Clear this locally saved project draft?")) return;

    clearProjectDraft();
    clearAnonymousDraftId();
    setDraft(getDefaultProjectDraft());
    setCustomTechnology("");
    setTouched(new Set());
    setShowAllErrors(false);
    setSubmittedRequest(null);
    setWorkspaceError(null);
    setSaveState("saved");
  }

  return (
    <section className="builder-section" id="builder" aria-labelledby="builder-title">
      <div className="page-width">
        {showAuthGate ? (
          <AuthGate
            onProjectReady={openWorkspace}
            onContinueLocally={continueLocally}
          />
        ) : null}
        <div className="section-heading builder-heading">
          <div>
            <p className="eyebrow">Solution builder</p>
            <h2 id="builder-title">Let&apos;s shape your idea.</h2>
          </div>
          <p>
            Give us the context, constraints, and direction. We&apos;ll turn your
            answers into a clean brief that is ready for the next step.
          </p>
        </div>

        {submittedRequest ? (
          <div ref={summaryRef} tabIndex={-1}>
            <ProjectSummary request={submittedRequest} onEdit={handleEditRequest} />
          </div>
        ) : null}

        <div className="builder-layout">
          <aside className="builder-aside" aria-label="Builder progress">
            <div className="builder-aside-card">
              <p className="aside-kicker">A better starting point</p>
              <h3>Bring the messy first draft. Leave with a useful brief.</h3>
              <p>
                This first version helps you describe the problem before tools
                and trade-offs enter the conversation.
              </p>
              <ol className="builder-steps">
                <li className="is-active">
                  <span>01</span>
                  <div>
                    <strong>Describe the idea</strong>
                    <small>What are you trying to make?</small>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Shape the constraints</strong>
                    <small>Budget, experience, and preferences.</small>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Prepare for recommendations</strong>
                    <small>Personalized guidance arrives in Phase 2.</small>
                  </div>
                </li>
              </ol>
            </div>
            <div className="privacy-note">
              <span aria-hidden="true">⌁</span>
              <p>
                Your unfinished draft is saved locally in this browser. It is
                not synced to an account or cloud service.
              </p>
            </div>
          </aside>

          <form
            ref={formRef}
            className="builder-form-card"
            onSubmit={handleSubmit}
            noValidate
          >
            <div className="form-card-header">
              <div>
                <p className="eyebrow">Project brief</p>
                <h3>Start with the outcome, not the tools.</h3>
              </div>
              {hasHydratedDraft ? (
                <span className={`save-status is-${saveState}`} role="status">
                  <span aria-hidden="true">{saveState === "saved" ? "✓" : "•"}</span>
                  {saveState === "saved"
                    ? "Saved locally"
                    : saveState === "unavailable"
                      ? "Local save unavailable"
                      : "Saving…"}
                </span>
              ) : null}
            </div>

            {workspaceError ? (
              <div className="form-alert" role="alert">
                <span>{workspaceError}</span>
                {submittedRequest ? (
                  <button className="button button-small button-secondary" type="button" onClick={continueLocally}>
                    Continue locally
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="form-body">
              <div className="form-field">
                <div className="field-heading">
                  <label htmlFor={FIELD_IDS.idea}>
                    Project idea <span className="required-mark">Required</span>
                  </label>
                  <span className="character-count">
                    {draft.idea.length}/{MAX_IDEA_LENGTH}
                  </span>
                </div>
                <textarea
                  id={FIELD_IDS.idea}
                  value={draft.idea}
                  maxLength={MAX_IDEA_LENGTH}
                  rows={5}
                  placeholder="For example: A simple travel planner that helps college students build affordable weekend itineraries."
                  aria-invalid={Boolean(getError("idea"))}
                  aria-describedby={getError("idea") ? "project-idea-error" : "project-idea-help"}
                  onChange={(event) => updateDraft("idea", event.target.value)}
                  onBlur={() => markTouched("idea")}
                />
                <p className="field-help" id="project-idea-help">
                  What do you want to build, who is it for, and what should it help them do?
                </p>
                {getError("idea") ? (
                  <p className="field-error" id="project-idea-error" role="alert">
                    {getError("idea")}
                  </p>
                ) : null}
              </div>

              <fieldset className="form-field">
                <legend>
                  Project category <span className="required-mark">Required</span>
                </legend>
                <div className="choice-grid category-grid">
                  {PROJECT_CATEGORIES.map((category) => (
                    <label
                      className={getOptionClass(draft.category === category)}
                      key={category}
                    >
                      <input
                        type="radio"
                        name="project-category"
                        value={category}
                        checked={draft.category === category}
                        onChange={() => updateDraft("category", category)}
                        onBlur={() => markTouched("category")}
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
                {getError("category") ? (
                  <p className="field-error" role="alert">
                    {getError("category")}
                  </p>
                ) : null}
              </fieldset>

              <div className="form-split">
                <div className="form-field">
                  <label htmlFor={FIELD_IDS.budgetInr}>
                    Your budget <span className="optional-mark">Optional</span>
                  </label>
                  <div className="input-with-prefix">
                    <span aria-hidden="true">₹</span>
                    <input
                      id={FIELD_IDS.budgetInr}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="100000000"
                      step="1"
                      value={draft.budgetInr}
                      placeholder="e.g. 25000"
                      aria-invalid={Boolean(getError("budgetInr"))}
                      aria-describedby={
                        getError("budgetInr") ? "project-budget-error" : undefined
                      }
                      onChange={(event) => updateDraft("budgetInr", event.target.value)}
                      onBlur={() => markTouched("budgetInr")}
                    />
                  </div>
                  <p className="field-help">A planning constraint, not an estimated project price.</p>
                  {getError("budgetInr") ? (
                    <p className="field-error" id="project-budget-error" role="alert">
                      {getError("budgetInr")}
                    </p>
                  ) : null}
                </div>

                <fieldset className="form-field">
                  <legend>
                    Experience level <span className="required-mark">Required</span>
                  </legend>
                  <div className="segmented-options">
                    {EXPERIENCE_LEVELS.map((level) => (
                      <label
                        className={getOptionClass(draft.experienceLevel === level)}
                        key={level}
                      >
                        <input
                          type="radio"
                          name="experience-level"
                          value={level}
                          checked={draft.experienceLevel === level}
                          onChange={() => updateDraft("experienceLevel", level)}
                          onBlur={() => markTouched("experienceLevel")}
                        />
                        <span>{level}</span>
                      </label>
                    ))}
                  </div>
                  {getError("experienceLevel") ? (
                    <p className="field-error" role="alert">
                      {getError("experienceLevel")}
                    </p>
                  ) : null}
                </fieldset>
              </div>

              <fieldset className="form-field">
                <legend>
                  Preferred technologies <span className="optional-mark">Optional</span>
                </legend>
                <p className="field-help field-help-top">
                  Pick a few technologies you already know or want to explore,
                  or leave this open.
                </p>
                <div
                  className="technology-picker"
                  id={FIELD_IDS.preferredTechnologies}
                >
                  <button
                    className={`technology-chip no-preference${draft.noTechnologyPreference ? " is-selected" : ""}`}
                    type="button"
                    aria-pressed={draft.noTechnologyPreference}
                    onClick={useNoTechnologyPreference}
                  >
                    <span aria-hidden="true">✦</span>
                    No preference
                  </button>
                  {technologyOptions.map((technology) => (
                  <button
                    className={`technology-chip${draft.preferredTechnologies.includes(technology) ? " is-selected" : ""}`}
                    type="button"
                    aria-pressed={draft.preferredTechnologies.includes(technology)}
                    key={technology}
                    disabled={
                      draft.preferredTechnologies.length >= MAX_TECHNOLOGIES &&
                      !draft.preferredTechnologies.includes(technology)
                    }
                    onClick={() => setTechnologyPreference(technology)}
                  >
                      {technology}
                    </button>
                  ))}
                </div>
                <div className="custom-technology-input">
                  <input
                    type="text"
                    value={customTechnology}
                    maxLength={40}
                    placeholder="Add another preference"
                    aria-label="Add another technology preference"
                    onChange={(event) => setCustomTechnology(event.target.value)}
                    onKeyDown={handleTechnologyKeyDown}
                  />
                  <button
                    className="button button-small button-secondary"
                    type="button"
                    onClick={addCustomTechnology}
                    disabled={
                      !customTechnology.trim() ||
                      draft.preferredTechnologies.length >= MAX_TECHNOLOGIES
                    }
                  >
                    Add
                  </button>
                </div>
                {draft.preferredTechnologies.length > 0 ? (
                  <div className="selected-technologies" aria-label="Selected technologies">
                    {draft.preferredTechnologies.map((technology) => (
                      <button
                        type="button"
                        key={technology}
                        onClick={() => setTechnologyPreference(technology)}
                        aria-label={`Remove ${technology}`}
                      >
                        {technology} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="selection-limit">
                  {draft.preferredTechnologies.length}/{MAX_TECHNOLOGIES} preferences selected
                </p>
                {getError("preferredTechnologies") ? (
                  <p className="field-error" role="alert">
                    {getError("preferredTechnologies")}
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="form-field">
                <legend>
                  Deployment preference <span className="required-mark">Required</span>
                </legend>
                <div className="choice-grid deployment-grid">
                  {DEPLOYMENT_PREFERENCES.map((preference) => (
                    <label
                      className={getOptionClass(draft.deploymentPreference === preference)}
                      key={preference}
                    >
                      <input
                        type="radio"
                        name="deployment-preference"
                        value={preference}
                        checked={draft.deploymentPreference === preference}
                        onChange={() => updateDraft("deploymentPreference", preference)}
                        onBlur={() => markTouched("deploymentPreference")}
                      />
                      <span>{preference}</span>
                    </label>
                  ))}
                </div>
                {getError("deploymentPreference") ? (
                  <p className="field-error" role="alert">
                    {getError("deploymentPreference")}
                  </p>
                ) : null}
              </fieldset>

              <div className="form-field">
                <div className="field-heading">
                  <label htmlFor={FIELD_IDS.additionalRequirements}>
                    Additional requirements <span className="optional-mark">Optional</span>
                  </label>
                  <span className="character-count">
                    {draft.additionalRequirements.length}/{MAX_REQUIREMENTS_LENGTH}
                  </span>
                </div>
                <textarea
                  id={FIELD_IDS.additionalRequirements}
                  value={draft.additionalRequirements}
                  maxLength={MAX_REQUIREMENTS_LENGTH}
                  rows={4}
                  placeholder="Mention must-have features, constraints, accessibility needs, or anything else we should keep in mind."
                  aria-invalid={Boolean(getError("additionalRequirements"))}
                  aria-describedby={
                    getError("additionalRequirements")
                      ? "additional-requirements-error"
                      : undefined
                  }
                  onChange={(event) =>
                    updateDraft("additionalRequirements", event.target.value)
                  }
                  onBlur={() => markTouched("additionalRequirements")}
                />
                {getError("additionalRequirements") ? (
                  <p
                    className="field-error"
                    id="additional-requirements-error"
                    role="alert"
                  >
                    {getError("additionalRequirements")}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="form-card-footer">
                <button className="button button-ghost" type="button" onClick={handleClearDraft} disabled={isCreatingWorkspace}>
                Clear local draft
              </button>
              <button className="button button-primary button-submit" type="submit" disabled={isCreatingWorkspace}>
                {isCreatingWorkspace ? "Opening workspace…" : "Create project workspace"}
                {!isCreatingWorkspace ? <span aria-hidden="true">↗</span> : null}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
