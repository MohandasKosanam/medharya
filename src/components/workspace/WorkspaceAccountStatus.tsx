"use client";

import { useEffect, useState } from "react";

import type { AuthUser } from "@/types/auth";

export function WorkspaceAccountStatus() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null || !("user" in payload)) return null;
        return payload.user as AuthUser;
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  }

  if (isLoading) return <span className="workspace-account-status">Checking account…</span>;
  if (!user) return <span className="workspace-account-status"><i aria-hidden="true" />Local mode</span>;

  return (
    <span className="workspace-account-status workspace-account-user">
      <i aria-hidden="true" />
      <span>{user.displayName}</span>
      <button type="button" onClick={logout}>Log out</button>
    </span>
  );
}
