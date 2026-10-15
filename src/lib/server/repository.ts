// Server-only boundary. This prototype deliberately uses one local JSON file and
// an in-process write queue; it is not a multi-instance or production datastore.
// Do not import this module from client components or browser-facing modules.
import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { applyWorkspaceRequestPatch, createProjectWorkspace } from "@/lib/workspace";
import { isProjectRequest } from "@/lib/project-request";
import {
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  type ProjectDraft,
  type ProjectRequest,
} from "@/types/project";
import type { WorkspaceRequestPatch } from "@/types/workspace";
import type { ProjectOperatingSystem } from "@/types/operating-system";
import type {
  AnonymousIdeaDraft,
  AuthUser,
  LoginInput,
  OwnedProject,
  ServerDatabase,
  SignupInput,
  StoredAuthUser,
  StoredSession,
} from "@/types/auth";
import {
  MAX_BUDGET_INR,
  MAX_IDEA_LENGTH,
  MAX_REQUIREMENTS_LENGTH,
  MAX_TECHNOLOGIES,
  MAX_TECHNOLOGY_LENGTH,
  createProjectRequest,
  validateProjectDraft,
} from "@/lib/validation";

const scrypt = promisify(nodeScrypt) as unknown as (
  password: string | Buffer,
  salt: string | Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export const SESSION_COOKIE_NAME = "medharya_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const ANONYMOUS_DRAFT_TTL_SECONDS = 60 * 60 * 24;
const PASSWORD_HASH_VERSION = "scrypt-v1";
const PASSWORD_KEY_LENGTH = 64;

export class RepositoryError extends Error {
  constructor(
    public readonly code:
      | "invalid-input"
      | "duplicate-user"
      | "invalid-credentials"
      | "draft-attached"
      | "not-found",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface CookieStoreLike {
  get(name: string): { value: string } | undefined;
  set(options: {
    name: string;
    value: string;
    expires?: Date;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    path?: string;
  }): unknown;
}

function emptyDatabase(): ServerDatabase {
  return {
    version: 1,
    users: [],
    anonymousIdeaDrafts: [],
    projects: [],
    sessions: [],
  };
}

export function getServerDataFilePath() {
  return process.env.MEDHARYA_SERVER_DATA_FILE?.trim() || join(process.cwd(), "data", "medharya-server.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown, maxLength = 10_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isValidProjectRequest(value: unknown): value is ProjectRequest {
  if (!isProjectRequest(value)) return false;
  return (
    Number.isFinite(Date.parse(value.submittedAt)) &&
    value.preferredTechnologies.every((technology) => technology.trim().length > 0)
  );
}

function isStoredUser(value: unknown): value is StoredAuthUser {
  return Boolean(
    isRecord(value) &&
      isNonEmptyString(value.id, 200) &&
      isNonEmptyString(value.email, 254) &&
      isNonEmptyString(value.displayName, 120) &&
      isNonEmptyString(value.createdAt, 80) &&
      isNonEmptyString(value.passwordHash, 500),
  );
}

function isAnonymousDraft(value: unknown): value is AnonymousIdeaDraft {
  return Boolean(
    isRecord(value) &&
      isNonEmptyString(value.id, 200) &&
      isValidProjectRequest(value.request) &&
      isNonEmptyString(value.createdAt, 80) &&
      isNonEmptyString(value.updatedAt, 80) &&
      isNonEmptyString(value.expiresAt, 80) &&
      (value.attachedUserId === null || isNonEmptyString(value.attachedUserId, 200)) &&
      (value.attachedProjectId === null || isNonEmptyString(value.attachedProjectId, 200)),
  );
}

function isOwnedProject(value: unknown): value is OwnedProject {
  return Boolean(
    isRecord(value) &&
      isNonEmptyString(value.id, 200) &&
      isNonEmptyString(value.ownerUserId, 200) &&
      isNonEmptyString(value.createdAt, 80) &&
      isNonEmptyString(value.updatedAt, 80) &&
      isRecord(value.workspace) &&
      isNonEmptyString(value.workspace.id, 200) &&
      isNonEmptyString(value.workspace.name, 240) &&
      isValidProjectRequest(value.workspace.request) &&
      Array.isArray(value.workspace.messages) &&
      isRecord(value.workspace.memory) &&
      Array.isArray(value.workspace.researchFindings) &&
      isRecord(value.workspace.plan),
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  return Boolean(
    isRecord(value) &&
      isNonEmptyString(value.id, 200) &&
      isNonEmptyString(value.userId, 200) &&
      isNonEmptyString(value.tokenHash, 200) &&
      isNonEmptyString(value.createdAt, 80) &&
      isNonEmptyString(value.expiresAt, 80),
  );
}

function defensivelyParseDatabase(value: unknown): ServerDatabase {
  if (!isRecord(value)) return emptyDatabase();

  return {
    version: 1,
    users: Array.isArray(value.users) ? value.users.filter(isStoredUser) : [],
    anonymousIdeaDrafts: Array.isArray(value.anonymousIdeaDrafts)
      ? value.anonymousIdeaDrafts.filter((draft): draft is AnonymousIdeaDraft => isAnonymousDraft(draft) && Date.parse(draft.expiresAt) > Date.now())
      : [],
    projects: Array.isArray(value.projects) ? value.projects.filter(isOwnedProject) : [],
    sessions: Array.isArray(value.sessions) ? value.sessions.filter(isStoredSession) : [],
  };
}

/** Malformed or missing data is treated as an empty prototype database. */
export async function readServerDatabase(): Promise<ServerDatabase> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ getServerDataFilePath(), "utf8");
    return defensivelyParseDatabase(JSON.parse(raw) as unknown);
  } catch {
    return emptyDatabase();
  }
}

/** Rename replaces the destination atomically after the complete JSON is written. */
export async function writeServerDatabase(database: ServerDatabase): Promise<void> {
  const filePath = getServerDataFilePath();
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(defensivelyParseDatabase(database), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

let mutationQueue: Promise<void> = Promise.resolve();

async function mutateDatabase<T>(mutator: (database: ServerDatabase) => T | Promise<T>): Promise<T> {
  const operation = mutationQueue.then(async () => {
    const database = await readServerDatabase();
    const result = await mutator(database);
    await writeServerDatabase(database);
    return result;
  });
  mutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function now() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user: StoredAuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export function toPublicUser(user: StoredAuthUser) {
  return publicUser(user);
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function equalDigest(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  })) as Buffer;
  return `${PASSWORD_HASH_VERSION}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [version, saltValue, digestValue] = encoded.split("$");
  if (version !== PASSWORD_HASH_VERSION || !saltValue || !digestValue) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(digestValue, "base64url");
    if (salt.length < 16 || expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = (await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    })) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

function createSessionRecord(userId: string, token: string): StoredSession {
  const createdAt = now();
  return {
    id: `session_${randomUUID()}`,
    userId,
    tokenHash: tokenDigest(token),
    createdAt,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

function projectFromDraft(draft: AnonymousIdeaDraft, ownerUserId: string): OwnedProject {
  const workspace = createProjectWorkspace(draft.request);
  return {
    id: workspace.id,
    ownerUserId,
    workspace,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export function parseProjectRequestInput(value: unknown): ProjectRequest | null {
  if (!isRecord(value)) return null;
  if ("request" in value) return parseProjectRequestInput(value.request);
  if ("projectRequest" in value) return parseProjectRequestInput(value.projectRequest);
  if ("draft" in value) return parseProjectRequestInput(value.draft);

  if (isValidProjectRequest(value)) {
    return {
      ...value,
      idea: value.idea.trim(),
      preferredTechnologies: value.preferredTechnologies.map((technology) => technology.trim()),
      additionalRequirements: value.additionalRequirements.trim(),
    };
  }

  if (
    typeof value.idea !== "string" ||
    typeof value.category !== "string" ||
    typeof value.budgetInr !== "string" ||
    typeof value.experienceLevel !== "string" ||
    !Array.isArray(value.preferredTechnologies) ||
    typeof value.noTechnologyPreference !== "boolean" ||
    typeof value.deploymentPreference !== "string" ||
    typeof value.additionalRequirements !== "string" ||
    !value.preferredTechnologies.every((item) => typeof item === "string")
  ) {
    return null;
  }

  const draft: ProjectDraft = {
    idea: value.idea,
    category: value.category as ProjectDraft["category"],
    budgetInr: value.budgetInr,
    experienceLevel: value.experienceLevel as ProjectDraft["experienceLevel"],
    preferredTechnologies: value.preferredTechnologies,
    noTechnologyPreference: value.noTechnologyPreference,
    deploymentPreference: value.deploymentPreference as ProjectDraft["deploymentPreference"],
    additionalRequirements: value.additionalRequirements,
  };
  if (Object.keys(validateProjectDraft(draft)).length > 0) return null;
  return createProjectRequest(draft);
}

export function parseWorkspaceRequestPatch(value: unknown): WorkspaceRequestPatch | null {
  if (!isRecord(value)) return null;
  const candidate = ("patch" in value ? value.patch : "requestPatch" in value ? value.requestPatch : value);
  if (!isRecord(candidate)) return null;

  const patch: WorkspaceRequestPatch = {};
  if ("idea" in candidate) {
    if (typeof candidate.idea !== "string" || candidate.idea.trim().length < 8 || candidate.idea.trim().length > MAX_IDEA_LENGTH) return null;
    patch.idea = candidate.idea.trim();
  }
  if ("category" in candidate) {
    if (typeof candidate.category !== "string" || !PROJECT_CATEGORIES.includes(candidate.category as never)) return null;
    patch.category = candidate.category as WorkspaceRequestPatch["category"];
  }
  if ("budgetInr" in candidate) {
    if (candidate.budgetInr !== null && (typeof candidate.budgetInr !== "number" || !Number.isSafeInteger(candidate.budgetInr) || candidate.budgetInr < 0 || candidate.budgetInr > MAX_BUDGET_INR)) return null;
    patch.budgetInr = candidate.budgetInr;
  }
  if ("experienceLevel" in candidate) {
    if (typeof candidate.experienceLevel !== "string" || !EXPERIENCE_LEVELS.includes(candidate.experienceLevel as never)) return null;
    patch.experienceLevel = candidate.experienceLevel as WorkspaceRequestPatch["experienceLevel"];
  }
  if ("preferredTechnologies" in candidate) {
    if (!Array.isArray(candidate.preferredTechnologies) || candidate.preferredTechnologies.length > MAX_TECHNOLOGIES || candidate.preferredTechnologies.some((item) => typeof item !== "string" || item.trim().length === 0 || item.trim().length > MAX_TECHNOLOGY_LENGTH)) return null;
    patch.preferredTechnologies = candidate.preferredTechnologies.map((item) => item.trim());
  }
  if ("deploymentPreference" in candidate) {
    if (typeof candidate.deploymentPreference !== "string" || !DEPLOYMENT_PREFERENCES.includes(candidate.deploymentPreference as never)) return null;
    patch.deploymentPreference = candidate.deploymentPreference as WorkspaceRequestPatch["deploymentPreference"];
  }
  if ("additionalRequirements" in candidate) {
    if (typeof candidate.additionalRequirements !== "string" || candidate.additionalRequirements.trim().length > MAX_REQUIREMENTS_LENGTH) return null;
    patch.additionalRequirements = candidate.additionalRequirements.trim();
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export async function saveAnonymousIdeaDraft(request: ProjectRequest, requestedId?: string) {
  if (!isValidProjectRequest(request)) throw new RepositoryError("invalid-input", "A valid project request is required.");
  if (requestedId !== undefined && (!isNonEmptyString(requestedId, 200) || requestedId.trim().length === 0)) throw new RepositoryError("invalid-input", "The draft id is invalid.");

  return mutateDatabase((database) => {
    const timestamp = now();
    const existing = requestedId ? database.anonymousIdeaDrafts.find((draft) => draft.id === requestedId) : undefined;
    if (existing) {
      if (existing.attachedUserId) return existing;
      existing.request = request;
      existing.updatedAt = timestamp;
      return existing;
    }

    const draft: AnonymousIdeaDraft = {
      id: requestedId || `draft_${randomUUID()}`,
      request,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + ANONYMOUS_DRAFT_TTL_SECONDS * 1000).toISOString(),
      attachedUserId: null,
      attachedProjectId: null,
    };
    database.anonymousIdeaDrafts.push(draft);
    return draft;
  });
}

export async function registerUser(input: SignupInput) {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new RepositoryError("invalid-input", "The signup details are invalid.");
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email) || input.password.length < 8 || input.password.length > 128) {
    throw new RepositoryError("invalid-input", "The signup details are invalid.");
  }
  if (input.displayName !== undefined && (typeof input.displayName !== "string" || input.displayName.trim().length > 120)) {
    throw new RepositoryError("invalid-input", "The display name is invalid.");
  }
  if (input.anonymousDraftId !== undefined && (!isNonEmptyString(input.anonymousDraftId, 200) || input.anonymousDraftId.trim().length === 0)) {
    throw new RepositoryError("invalid-input", "The anonymous draft id is invalid.");
  }
  const passwordHash = await hashPassword(input.password);

  return mutateDatabase(async (database) => {
    const draft = input.anonymousDraftId
      ? database.anonymousIdeaDrafts.find((candidate) => candidate.id === input.anonymousDraftId)
      : undefined;
    if (input.anonymousDraftId && !draft) throw new RepositoryError("not-found", "The anonymous draft was not found.");

    const existingUser = database.users.find((user) => user.email === email);
    if (existingUser) {
      // A retried signup with the same draft and valid credentials is a safe
      // idempotent replay: never create a second project or attach the draft twice.
      if (draft?.attachedUserId === existingUser.id && (await verifyPassword(input.password, existingUser.passwordHash))) {
        const project = draft.attachedProjectId
          ? database.projects.find((candidate) => candidate.id === draft.attachedProjectId) || null
          : null;
        const token = createOpaqueToken();
        const session = createSessionRecord(existingUser.id, token);
        database.sessions.push(session);
        return { user: publicUser(existingUser), project, token, expiresAt: session.expiresAt };
      }
      throw new RepositoryError("duplicate-user", "An account already exists for that email.");
    }

    if (draft?.attachedUserId) throw new RepositoryError("draft-attached", "The anonymous draft has already been attached.");

    const timestamp = now();
    const user: StoredAuthUser = {
      id: `user_${randomUUID()}`,
      email,
      displayName: input.displayName?.trim() || email.split("@")[0] || "Medharya user",
      passwordHash,
      createdAt: timestamp,
    };
    database.users.push(user);

    let project: OwnedProject | null = null;
    if (draft) {
      project = projectFromDraft(draft, user.id);
      database.projects.push(project);
      draft.attachedUserId = user.id;
      draft.attachedProjectId = project.id;
      draft.updatedAt = timestamp;
    }

    const token = createOpaqueToken();
    const session = createSessionRecord(user.id, token);
    database.sessions.push(session);
    return { user: publicUser(user), project, token, expiresAt: session.expiresAt };
  });
}

export async function authenticateUser(input: LoginInput) {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new RepositoryError("invalid-credentials", "Invalid email or password.");
  }
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email) || input.password.length === 0 || input.password.length > 128) {
    throw new RepositoryError("invalid-credentials", "Invalid email or password.");
  }
  const database = await readServerDatabase();
  const user = database.users.find((candidate) => candidate.email === email);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new RepositoryError("invalid-credentials", "Invalid email or password.");
  }
  return user;
}

export async function createSession(userId: string) {
  const token = createOpaqueToken();
  return mutateDatabase((database) => {
    if (!database.users.some((user) => user.id === userId)) throw new RepositoryError("not-found", "The user was not found.");
    const session = createSessionRecord(userId, token);
    database.sessions = database.sessions.filter((candidate) => Date.parse(candidate.expiresAt) > Date.now());
    database.sessions.push(session);
    return { token, expiresAt: session.expiresAt };
  });
}

export async function findUserBySessionToken(token: string | undefined) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const database = await readServerDatabase();
  const session = database.sessions.find((candidate) => equalDigest(candidate.tokenHash, tokenDigest(token)));
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = database.users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}

export async function revokeSessionToken(token: string | undefined) {
  if (!token) return;
  const hash = tokenDigest(token);
  await mutateDatabase((database) => {
    database.sessions = database.sessions.filter((session) => !equalDigest(session.tokenHash, hash));
  });
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return findUserBySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export function setSessionCookie(cookieStore: CookieStoreLike, token: string, expiresAt: string) {
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    expires: new Date(expiresAt),
    maxAge: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export function clearSessionCookie(cookieStore: CookieStoreLike) {
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    expires: new Date(0),
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function getOwnedProject(projectId: string, ownerUserId: string) {
  const database = await readServerDatabase();
  return database.projects.find((project) => project.id === projectId && project.ownerUserId === ownerUserId) || null;
}

export async function updateOwnedProject(projectId: string, ownerUserId: string, patch: WorkspaceRequestPatch) {
  return mutateDatabase((database) => {
    const project = database.projects.find((candidate) => candidate.id === projectId && candidate.ownerUserId === ownerUserId);
    if (!project) return null;
    project.workspace = applyWorkspaceRequestPatch(project.workspace, patch);
    project.updatedAt = project.workspace.updatedAt;
    return project;
  });
}

function isOperatingSystemShape(value: unknown): value is ProjectOperatingSystem {
  if (!isRecord(value)) return false;
  return Boolean(
    Array.isArray(value.branches) &&
      value.branches.length <= 100 &&
      value.branches.every((branch) => isRecord(branch) && isNonEmptyString(branch.id, 200) && isNonEmptyString(branch.workspaceId, 200) && isNonEmptyString(branch.name, 160) && Array.isArray(branch.messages) && Array.isArray(branch.taskIds)) &&
      Array.isArray(value.edges) && value.edges.length <= 300 &&
      Array.isArray(value.tasks) && value.tasks.length <= 500 &&
      value.tasks.every((task) => isRecord(task) && isNonEmptyString(task.id, 200) && isNonEmptyString(task.title, 240) && isNonEmptyString(task.branchId, 200) && isNonEmptyString(task.status, 40)) &&
      Array.isArray(value.milestones) && value.milestones.length <= 100 &&
      Array.isArray(value.automations) && value.automations.length <= 50 &&
      Array.isArray(value.automationRuns) && value.automationRuns.length <= 200 &&
      Array.isArray(value.discoveryQuestions) && value.discoveryQuestions.length <= 100 &&
      Array.isArray(value.discoveryAnswers) && value.discoveryAnswers.length <= 200 &&
      Array.isArray(value.decisions) && value.decisions.length <= 200 &&
      isRecord(value.preferences) && isNonEmptyString(value.preferences.id, 200),
  );
}

export function parseOperatingSystemInput(value: unknown): ProjectOperatingSystem | null {
  if (!isOperatingSystemShape(value)) return null;
  return value;
}

export async function updateOwnedProjectOperatingSystem(
  projectId: string,
  ownerUserId: string,
  operatingSystem: ProjectOperatingSystem,
) {
  if (!operatingSystem.branches.every((branch) => branch.workspaceId === projectId)) {
    throw new RepositoryError("invalid-input", "Branch records must belong to the project being updated.");
  }
  return mutateDatabase((database) => {
    const project = database.projects.find(
      (candidate) => candidate.id === projectId && candidate.ownerUserId === ownerUserId,
    );
    if (!project) return null;
    project.workspace = {
      ...project.workspace,
      operatingSystem,
      updatedAt: now(),
    };
    project.updatedAt = project.workspace.updatedAt;
    return project;
  });
}

/** Idempotent by anonymous draft id: a repeated attach returns the original project. */
export async function attachAnonymousDraftToUser(draftId: string, userId: string) {
  return mutateDatabase((database) => {
    const draft = database.anonymousIdeaDrafts.find((candidate) => candidate.id === draftId);
    if (!draft) throw new RepositoryError("not-found", "The anonymous draft was not found.");
    if (draft.attachedUserId && draft.attachedUserId !== userId) throw new RepositoryError("draft-attached", "The anonymous draft has already been attached.");
    if (draft.attachedProjectId) {
      return database.projects.find((project) => project.id === draft.attachedProjectId) || null;
    }
    const project = projectFromDraft(draft, userId);
    database.projects.push(project);
    draft.attachedUserId = userId;
    draft.attachedProjectId = project.id;
    draft.updatedAt = now();
    return project;
  });
}
