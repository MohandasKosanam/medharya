"use client";

import { useState, type FormEvent } from "react";

import type { ProjectWorkspace } from "@/types/workspace";
import { Brand } from "@/components/layout/Brand";
import { Fire } from "@/components/visual/DecorativeEffects";

type AuthMode = "signup" | "login";

type AuthGateProps = {
  onProjectReady: (workspace: ProjectWorkspace) => void;
  onContinueLocally: () => void;
};

async function responsePayload(response: Response) {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function AuthGate({ onProjectReady, onContinueLocally }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(mode === "signup" ? { displayName } : {}),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "The account request could not be completed.");
      }
      if (!payload.project || typeof payload.project !== "object") {
        throw new Error("Your account is ready, but the project draft was not attached. Try the account request again.");
      }
      onProjectReady(payload.project as ProjectWorkspace);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The account request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="auth-gate auth-gate-split"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-gate-title"
    >
      <div className="auth-gate-layout">
        <aside className="auth-story" aria-label="Project handoff">
          <div className="auth-story-decoration" aria-hidden="true">
            <span className="auth-story-orbit auth-story-orbit-one" />
            <span className="auth-story-orbit auth-story-orbit-two" />
            <Fire className="auth-story-fire" />
          </div>
          <div className="auth-story-content">
            <p className="eyebrow">Your project is taking shape</p>
            <h2>Keep the signal. Carry it into your workspace.</h2>
            <p>
              Your idea draft is safely held with a short-lived server record.
              Connect an account to attach it to an owned project and continue
              the discovery interview.
            </p>
            <ol className="auth-story-steps" aria-label="Project handoff steps">
              <li className="is-complete">
                <span>01</span>
                <div>
                  <strong>Brief captured</strong>
                  <small>Your idea and constraints are ready.</small>
                </div>
              </li>
              <li className="is-active">
                <span>02</span>
                <div>
                  <strong>Connect an account</strong>
                  <small>Save the project to an owned workspace.</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Continue discovery</strong>
                  <small>Keep shaping the direction with context.</small>
                </div>
              </li>
            </ol>
            <p className="auth-story-note">
              You can still continue locally if you are not ready to create an
              account.
            </p>
          </div>
        </aside>

        <section className="auth-panel" aria-labelledby="auth-gate-title">
          <div className="auth-gate-card">
            <Brand className="auth-brand" />
            <div className="auth-gate-heading">
              <p className="eyebrow">Keep your project moving</p>
              <h2 id="auth-gate-title">
                {mode === "login" ? "Welcome back." : "Save this workspace."}
              </h2>
              <p>
                {mode === "login"
                  ? "Sign in to continue with Medharya and reopen your project."
                  : "Create an account or sign in to attach your brief to an owned project."}
              </p>
            </div>
            <div className="auth-mode-switch" role="tablist" aria-label="Account action">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "is-active" : ""}
                onClick={() => { setMode("signup"); setError(null); }}
              >
                Create account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => { setMode("login"); setError(null); }}
              >
                Sign in
              </button>
            </div>
            <form className="auth-gate-form auth-form" id="auth-gate-form" onSubmit={handleSubmit}>
              {mode === "signup" ? (
                <label className="auth-field auth-display-name">
                  <span>Display name <small>Optional</small></span>
                  <input value={displayName} maxLength={120} autoComplete="name" placeholder="How should Medharya address you?" onChange={(event) => setDisplayName(event.target.value)} />
                </label>
              ) : null}
              <label className="auth-field">
                <span>Email</span>
                <input type="email" required autoComplete="email" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input type="password" required minLength={8} maxLength={128} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} placeholder="At least 8 characters" onChange={(event) => setPassword(event.target.value)} />
              </label>
              {error ? <p className="workspace-inline-error auth-error" role="alert">{error}</p> : null}
              <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving securely…" : mode === "signup" ? "Create account & open workspace" : "Sign in & open workspace"}
                {!isSubmitting ? <span aria-hidden="true">↗</span> : null}
              </button>
            </form>
            <div className="auth-gate-footer auth-form-footer">
              <p>Prototype boundary: account data is stored in the configured server-side repository; no client user ID is trusted.</p>
              <button type="button" className="button button-ghost" onClick={onContinueLocally}>Continue locally without an account</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
