"use client";

import { useState, type FormEvent } from "react";

import type { ProjectWorkspace } from "@/types/workspace";

type AuthMode = "signup" | "login";

type AuthGateProps = {
  draftId: string;
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

export function AuthGate({ draftId, onProjectReady, onContinueLocally }: AuthGateProps) {
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
          anonymousDraftId: draftId,
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "The account request could not be completed.");
      }
      if (!payload.project || typeof payload.project !== "object") {
        throw new Error("Your account is ready, but the project draft was not attached. Keep the draft id and try again.");
      }
      onProjectReady(payload.project as ProjectWorkspace);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The account request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
      <div className="auth-gate-card">
        <div className="auth-gate-heading">
          <p className="eyebrow">Keep your project moving</p>
          <h2 id="auth-gate-title">Save this workspace and continue the discovery interview.</h2>
          <p>Your idea draft is safely held with a short-lived server record. Create an account or sign in to attach it to an owned project.</p>
        </div>
        <div className="auth-mode-switch" role="tablist" aria-label="Account action">
          <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => { setMode("signup"); setError(null); }}>Create account</button>
          <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => { setMode("login"); setError(null); }}>Sign in</button>
        </div>
        <form className="auth-gate-form" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <label>
              Display name <span>Optional</span>
              <input value={displayName} maxLength={120} autoComplete="name" placeholder="How should Medharya address you?" onChange={(event) => setDisplayName(event.target.value)} />
            </label>
          ) : null}
          <label>
            Email
            <input type="email" required autoComplete="email" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" required minLength={8} maxLength={128} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} placeholder="At least 8 characters" onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="workspace-inline-error" role="alert">{error}</p> : null}
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving securely…" : mode === "signup" ? "Create account & open workspace" : "Sign in & open workspace"}
            {!isSubmitting ? <span aria-hidden="true">↗</span> : null}
          </button>
        </form>
        <div className="auth-gate-footer">
          <p>Prototype boundary: account data is stored in the configured server-side repository; no client user ID is trusted.</p>
          <button type="button" className="button button-ghost" onClick={onContinueLocally}>Continue locally without an account</button>
        </div>
      </div>
    </div>
  );
}
