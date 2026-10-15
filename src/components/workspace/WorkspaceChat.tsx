"use client";

import { useState, type KeyboardEvent } from "react";

import type { WorkspaceMessage } from "@/types/workspace";

type WorkspaceChatProps = {
  messages: WorkspaceMessage[];
  isSending: boolean;
  error: string | null;
  notice: string | null;
  onSend: (content: string) => void;
  onRetry?: () => void;
};

function sourceLabel(message: WorkspaceMessage) {
  if (message.role === "user") return "You";
  if (message.source === "model-assisted") return "Medharya · model-assisted";
  if (message.source === "web-researched") return "Medharya · researched";
  return "Medharya · rule-based fallback";
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function WorkspaceChat({ messages, isSending, error, notice, onSend, onRetry }: WorkspaceChatProps) {
  const [draft, setDraft] = useState("");

  function send() {
    const message = draft.trim();
    if (!message || isSending) return;
    onSend(message);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <section className="workspace-chat" aria-labelledby="workspace-chat-title">
      <div className="workspace-panel-heading">
        <div>
          <p className="eyebrow">Project conversation</p>
          <h2 id="workspace-chat-title">Think it through with Medharya.</h2>
        </div>
        <span className="workspace-live-indicator"><i aria-hidden="true" /> Context linked</span>
      </div>
      <div className="chat-history" aria-live="polite">
        {messages.map((message) => (
          <article className={`chat-message chat-message-${message.role}`} key={message.id}>
            <div className="chat-message-meta">
              <span>{sourceLabel(message)}</span>
              <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
            </div>
            <p>{message.content}</p>
            {message.citations?.length ? (
              <div className="message-citations">
                {message.citations.map((citation) => (
                  <a href={citation.url} target="_blank" rel="noreferrer" key={citation.url}>
                    {citation.title} {citation.evidenceId ? <small>Evidence {citation.evidenceId}</small> : null} <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {isSending ? (
          <div className="chat-working" role="status">
            <span className="working-dots" aria-hidden="true"><i /><i /><i /></span>
            Medharya is checking the project context…
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="chat-error" role="alert">
          <p className="workspace-inline-error">{error}</p>
          {onRetry ? <button className="button button-secondary button-small" type="button" onClick={onRetry} disabled={isSending}>Retry server response</button> : null}
        </div>
      ) : null}
      {notice ? <p className="workspace-inline-note" role="status">{notice}</p> : null}
      <div className="chat-composer">
        <label className="sr-only" htmlFor="workspace-message">Message Medharya</label>
        <textarea
          id="workspace-message"
          value={draft}
          rows={3}
          maxLength={4_000}
          placeholder="Ask why a tool fits, challenge a decision, or tell Medharya what changed…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
        />
        <div className="composer-footer">
          <span>Enter to send · Shift + Enter for a new line</span>
          <button className="button button-primary button-small" type="button" onClick={send} disabled={isSending || !draft.trim()}>
            {isSending ? "Working…" : "Send message"}
            {!isSending ? <span aria-hidden="true">↗</span> : null}
          </button>
        </div>
      </div>
    </section>
  );
}
