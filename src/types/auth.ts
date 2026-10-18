import type { ProjectRequest } from "@/types/project";
import type { ProjectWorkspace } from "@/types/workspace";

/** Public account data safe to return from an API response. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

/** The password-bearing record is kept inside the server repository only. */
export interface StoredAuthUser extends AuthUser {
  passwordHash: string;
}

export interface AnonymousIdeaDraft {
  id: string;
  request: ProjectRequest;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  attachedUserId: string | null;
  attachedProjectId: string | null;
}

export interface OwnedProject {
  id: string;
  ownerUserId: string;
  workspace: ProjectWorkspace;
  createdAt: string;
  updatedAt: string;
}

/** Only a digest is persisted; the opaque token is never written to disk. */
export interface StoredSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface ServerDatabase {
  version: 1;
  users: StoredAuthUser[];
  anonymousIdeaDrafts: AnonymousIdeaDraft[];
  projects: OwnedProject[];
  sessions: StoredSession[];
}

export interface SignupInput {
  email: string;
  password: string;
  displayName?: string;
  anonymousDraftId?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  anonymousDraftId?: string;
}
