// Server-only boundary. PostgreSQL is the production repository; the JSON file is
// retained only for local/offline development and tests. Do not import this module
// from client components or browser-facing modules.
import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";

import { applyWorkspaceRequestPatch, createProjectWorkspace } from "@/lib/workspace";
import { generateServerSolutionPlan } from "@/lib/server/recommendations";
import {
  ensureOperatingSystem,
  isValidCanvasPosition,
  isValidCanvasViewport,
  removeBranchTree,
} from "@/lib/operating-system";
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
import type { ProjectWorkspace } from "@/types/workspace";

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
export const DATABASE_UNAVAILABLE_MESSAGE =
  "Persistent storage is unavailable. Configure DATABASE_URL and apply db/migrations/001_initial.sql before starting production.";

export type RepositoryBackend = "postgres" | "json" | "unavailable";

export class RepositoryError extends Error {
  public readonly code:
    | "invalid-input"
    | "duplicate-user"
    | "invalid-credentials"
    | "draft-attached"
    | "not-found"
    | "unavailable";

  constructor(
    code:
      | "invalid-input"
      | "duplicate-user"
      | "invalid-credentials"
      | "draft-attached"
      | "not-found"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
  }
}

export function isRepositoryUnavailable(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError && error.code === "unavailable";
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

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl || null;
}

export function getRepositoryBackend(): RepositoryBackend {
  if (getDatabaseUrl()) return "postgres";
  const explicitTestRepository =
    process.env.MEDHARYA_REPOSITORY_TEST_MODE === "1" && Boolean(process.env.MEDHARYA_SERVER_DATA_FILE?.trim());
  return process.env.NODE_ENV === "production" && !explicitTestRepository ? "unavailable" : "json";
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

export function parseServerDatabase(value: unknown): ServerDatabase {
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

function rowString(row: Record<string, unknown>, key: string) {
  return typeof row[key] === "string" ? row[key] as string : "";
}

function rowTimestamp(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function rowJson(row: Record<string, unknown>, key: string): unknown {
  const value = row[key];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function queryRows(executor: Pool | PoolClient, text: string, values: unknown[] = []) {
  const result = await executor.query(text, values);
  return result.rows as Array<Record<string, unknown>>;
}

async function readPostgresDatabase(executor: Pool | PoolClient): Promise<ServerDatabase> {
  const users = await queryRows(
    executor,
    `SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash", created_at AS "createdAt"
       FROM users`,
  );
  const drafts = await queryRows(
    executor,
    `SELECT id, request, created_at AS "createdAt", updated_at AS "updatedAt", expires_at AS "expiresAt",
            attached_user_id AS "attachedUserId", attached_project_id AS "attachedProjectId"
       FROM anonymous_drafts`,
  );
  const projects = await queryRows(
    executor,
    `SELECT id, owner_user_id AS "ownerUserId", workspace, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects`,
  );
  const sessions = await queryRows(
    executor,
    `SELECT id, user_id AS "userId", token_hash AS "tokenHash", created_at AS "createdAt", expires_at AS "expiresAt"
       FROM sessions`,
  );

  return parseServerDatabase({
    version: 1,
    users: users.map((row) => ({
      id: rowString(row, "id"),
      email: rowString(row, "email"),
      displayName: rowString(row, "displayName"),
      passwordHash: rowString(row, "passwordHash"),
      createdAt: rowTimestamp(row, "createdAt"),
    })),
    anonymousIdeaDrafts: drafts.map((row) => ({
      id: rowString(row, "id"),
      request: rowJson(row, "request"),
      createdAt: rowTimestamp(row, "createdAt"),
      updatedAt: rowTimestamp(row, "updatedAt"),
      expiresAt: rowTimestamp(row, "expiresAt"),
      attachedUserId: row.attachedUserId === null ? null : rowString(row, "attachedUserId"),
      attachedProjectId: row.attachedProjectId === null ? null : rowString(row, "attachedProjectId"),
    })),
    projects: projects.map((row) => ({
      id: rowString(row, "id"),
      ownerUserId: rowString(row, "ownerUserId"),
      workspace: rowJson(row, "workspace"),
      createdAt: rowTimestamp(row, "createdAt"),
      updatedAt: rowTimestamp(row, "updatedAt"),
    })),
    sessions: sessions.map((row) => ({
      id: rowString(row, "id"),
      userId: rowString(row, "userId"),
      tokenHash: rowString(row, "tokenHash"),
      createdAt: rowTimestamp(row, "createdAt"),
      expiresAt: rowTimestamp(row, "expiresAt"),
    })),
  });
}

async function replacePostgresDatabase(executor: Pool | PoolClient, database: ServerDatabase) {
  const normalized = parseServerDatabase(database);

  // The caller holds the repository transaction lock. Delete in dependency order,
  // then insert in parent-before-child order so the schema's foreign keys remain
  // useful even though this compatibility adapter stores a full snapshot.
  await executor.query("DELETE FROM sessions");
  await executor.query("DELETE FROM anonymous_drafts");
  await executor.query("DELETE FROM projects");
  await executor.query("DELETE FROM users");

  for (const user of normalized.users) {
    await executor.query(
      `INSERT INTO users (id, email, display_name, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.displayName, user.passwordHash, user.createdAt],
    );
  }
  for (const project of normalized.projects) {
    await executor.query(
      `INSERT INTO projects (id, owner_user_id, workspace, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [project.id, project.ownerUserId, JSON.stringify(project.workspace), project.createdAt, project.updatedAt],
    );
  }
  for (const draft of normalized.anonymousIdeaDrafts) {
    await executor.query(
      `INSERT INTO anonymous_drafts
        (id, request, created_at, updated_at, expires_at, attached_user_id, attached_project_id)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)`,
      [
        draft.id,
        JSON.stringify(draft.request),
        draft.createdAt,
        draft.updatedAt,
        draft.expiresAt,
        draft.attachedUserId,
        draft.attachedProjectId,
      ],
    );
  }
  for (const session of normalized.sessions) {
    await executor.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt],
    );
  }
}

let postgresPool: Pool | null = null;
let postgresPoolUrl: string | null = null;

function getPostgresPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) throw new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
  if (!postgresPool || postgresPoolUrl !== databaseUrl) {
    postgresPool = new Pool({
      connectionString: databaseUrl,
      application_name: "medharya",
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    postgresPool.on("error", () => {
      // Request-scoped queries report failures to the typed repository boundary;
      // this listener prevents an idle-client error from becoming an uncaught
      // process exception.
    });
    postgresPoolUrl = databaseUrl;
  }
  return postgresPool;
}

function normalizeStorageError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  if (
    isRecord(error) &&
    error.code === "23505" &&
    typeof error.constraint === "string" &&
    error.constraint.includes("email")
  ) {
    return new RepositoryError("duplicate-user", "An account already exists for that email.");
  }
  return new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
}

async function withPostgresTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  let client: PoolClient | undefined;
  let started = false;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    started = true;
    // Keep the snapshot adapter safe across multiple app instances. The lock is
    // transaction-scoped and does not involve any external model/provider call.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('medharya:repository'))");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (client && started) await client.query("ROLLBACK").catch(() => undefined);
    throw normalizeStorageError(error);
  } finally {
    client?.release();
  }
}

async function readJsonServerDatabase(): Promise<ServerDatabase> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ getServerDataFilePath(), "utf8");
    return parseServerDatabase(JSON.parse(raw) as unknown);
  } catch {
    // Missing or malformed JSON is an intentionally local/offline empty store.
    return emptyDatabase();
  }
}

/** Read from PostgreSQL in configured environments, or the local JSON store offline. */
export async function readServerDatabase(): Promise<ServerDatabase> {
  const backend = getRepositoryBackend();
  if (backend === "unavailable") throw new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
  if (backend === "json") return readJsonServerDatabase();

  try {
    return await readPostgresDatabase(getPostgresPool());
  } catch (error) {
    throw normalizeStorageError(error);
  }
}

async function writeJsonServerDatabase(database: ServerDatabase): Promise<void> {
  const filePath = getServerDataFilePath();
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(parseServerDatabase(database), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

/** Persist a complete database snapshot using the configured repository. */
export async function writeServerDatabase(database: ServerDatabase): Promise<void> {
  const backend = getRepositoryBackend();
  if (backend === "unavailable") throw new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
  if (backend === "json") return writeJsonServerDatabase(database);
  await withPostgresTransaction((client) => replacePostgresDatabase(client, database));
}

let mutationQueue: Promise<void> = Promise.resolve();

async function mutateDatabase<T>(mutator: (database: ServerDatabase) => T | Promise<T>): Promise<T> {
  const backend = getRepositoryBackend();
  if (backend === "unavailable") throw new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
  if (backend === "postgres") {
    return withPostgresTransaction(async (client) => {
      const database = await readPostgresDatabase(client);
      const result = await mutator(database);
      await replacePostgresDatabase(client, database);
      return result;
    });
  }

  const operation = mutationQueue.then(async () => {
    const database = await readJsonServerDatabase();
    const result = await mutator(database);
    await writeJsonServerDatabase(database);
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

async function enhanceOwnedProjectPlan(project: OwnedProject) {
  try {
    const result = await generateServerSolutionPlan(project.workspace.request, project.workspace.plan.version);
    if (!result.usedFallback) {
      project.workspace = {
        ...project.workspace,
        plan: result.plan,
        updatedAt: now(),
      };
      project.updatedAt = project.workspace.updatedAt;
    }
  } catch {
    // Account/project creation must retain the deterministic plan if a model
    // provider fails unexpectedly; the plan provenance remains truthful.
  }
  return project;
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

  // Read and perform any optional model enhancement before opening the database
  // transaction. The transaction below still re-checks the draft and account so
  // concurrent signups cannot attach the same draft twice.
  const snapshot = await readServerDatabase();
  const snapshotDraft = input.anonymousDraftId
    ? snapshot.anonymousIdeaDrafts.find((candidate) => candidate.id === input.anonymousDraftId)
    : undefined;
  if (input.anonymousDraftId && !snapshotDraft) {
    throw new RepositoryError("not-found", "The anonymous draft was not found.");
  }
  const snapshotUser = snapshot.users.find((candidate) => candidate.email === email);
  if (snapshotUser) {
    if (
      snapshotDraft?.attachedUserId === snapshotUser.id &&
      (await verifyPassword(input.password, snapshotUser.passwordHash))
    ) {
      // The transaction below re-reads the same state and creates only the
      // replacement session for an idempotent signup replay.
    } else {
      throw new RepositoryError("duplicate-user", "An account already exists for that email.");
    }
  }

  const user: StoredAuthUser = {
    id: `user_${randomUUID()}`,
    email,
    displayName: input.displayName?.trim() || email.split("@")[0] || "Medharya user",
    passwordHash,
    createdAt: now(),
  };
  const preparedProject = snapshotDraft && !snapshotDraft.attachedUserId
    ? await enhanceOwnedProjectPlan(projectFromDraft(snapshotDraft, user.id))
    : null;

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

    const timestamp = user.createdAt;
    database.users.push(user);

    let project: OwnedProject | null = null;
    if (draft) {
      const preparedRequestMatches = preparedProject && JSON.stringify(preparedProject.workspace.request) === JSON.stringify(draft.request);
      project = preparedRequestMatches
        ? { ...preparedProject, ownerUserId: user.id }
        : projectFromDraft(draft, user.id);
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
  if (!token) {
    if (getRepositoryBackend() === "unavailable") {
      throw new RepositoryError("unavailable", DATABASE_UNAVAILABLE_MESSAGE);
    }
    return;
  }
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
  const project = database.projects.find((candidate) => candidate.id === projectId && candidate.ownerUserId === ownerUserId);
  return project
    ? { ...project, workspace: ensureOperatingSystem(project.workspace) }
    : null;
}

/**
 * Apply a server-created workspace change after re-checking ownership inside the
 * serialized mutation. The updater never receives client-owned state from a
 * route, so chat and research cannot overwrite another project by id alone.
 */
export async function updateOwnedProjectWorkspace(
  projectId: string,
  ownerUserId: string,
  updater: (workspace: ProjectWorkspace) => ProjectWorkspace,
) {
  return mutateDatabase((database) => {
    const project = database.projects.find((candidate) => candidate.id === projectId && candidate.ownerUserId === ownerUserId);
    if (!project) return null;
    const candidateWorkspace = updater(project.workspace);
    const nextWorkspace = ensureOperatingSystem(candidateWorkspace);
    const legacyResearchFindingIds = legacyResearchFindingIdsFor(project.workspace);
    const operatingSystemError = nextWorkspace.operatingSystem
      ? operatingSystemValidationError(nextWorkspace.operatingSystem, projectId, nextWorkspace, legacyResearchFindingIds)
      : null;
    if (
      nextWorkspace.id !== project.id ||
      nextWorkspace.messages.length > 100 ||
      nextWorkspace.researchFindings.length > 100 ||
      (nextWorkspace.researchSources?.length ?? 0) > 150 ||
      (nextWorkspace.researchEvidence?.length ?? 0) > 150 ||
      (nextWorkspace.researchClaims?.length ?? 0) > 150 ||
      operatingSystemError
    ) {
      throw new RepositoryError("invalid-input", operatingSystemError ?? "The generated project update exceeded a safe size limit.");
    }
    project.workspace = nextWorkspace;
    project.updatedAt = nextWorkspace.updatedAt;
    return project;
  });
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

const BRANCH_EDGE_RELATIONSHIPS = new Set(["depends-on", "informs", "blocks", "related-to"]);

function isBranchShape(value: unknown) {
  if (!isRecord(value)) return false;
  return Boolean(
    isNonEmptyString(value.id, 200) &&
      isNonEmptyString(value.workspaceId, 200) &&
      isNonEmptyString(value.name, 160) &&
      (!('messages' in value) || Array.isArray(value.messages)) &&
      (!('taskIds' in value) || Array.isArray(value.taskIds)) &&
      (!('parentBranchId' in value) || value.parentBranchId === undefined || isNonEmptyString(value.parentBranchId, 200)) &&
      (!('canvasPosition' in value) || value.canvasPosition === undefined || isValidCanvasPosition(value.canvasPosition)) &&
      (!('requirements' in value) || Array.isArray(value.requirements)) &&
      (!('researchFindingIds' in value) || Array.isArray(value.researchFindingIds)) &&
      (!('decisionIds' in value) || Array.isArray(value.decisionIds))
  );
}

function isEdgeShape(value: unknown) {
  if (!isRecord(value)) return false;
  return Boolean(
    isNonEmptyString(value.id, 200) &&
      isNonEmptyString(value.fromBranchId, 200) &&
      isNonEmptyString(value.toBranchId, 200) &&
      typeof value.relationship === "string" &&
      BRANCH_EDGE_RELATIONSHIPS.has(value.relationship) &&
      (value.status === "active" || value.status === "archived")
  );
}

function isOperatingSystemShape(value: unknown): value is ProjectOperatingSystem {
  if (!isRecord(value)) return false;
  return Boolean(
      Array.isArray(value.branches) &&
      value.branches.length <= 100 &&
      value.branches.every(isBranchShape) &&
      Array.isArray(value.edges) && value.edges.length <= 300 &&
      value.edges.every(isEdgeShape) &&
      (!('viewport' in value) || value.viewport === undefined || isValidCanvasViewport(value.viewport)) &&
      (!('canvasViewport' in value) || value.canvasViewport === undefined || isValidCanvasViewport(value.canvasViewport)) &&
      Array.isArray(value.tasks) && value.tasks.length <= 500 &&
      value.tasks.every((task) => isRecord(task) && isNonEmptyString(task.id, 200) && isNonEmptyString(task.title, 240) && isNonEmptyString(task.branchId, 200) && isNonEmptyString(task.status, 40)) &&
      Array.isArray(value.milestones) && value.milestones.length <= 100 &&
      value.milestones.every((milestone) => isRecord(milestone) && isNonEmptyString(milestone.id, 200) && isNonEmptyString(milestone.branchId, 200)) &&
      Array.isArray(value.automations) && value.automations.length <= 50 &&
      Array.isArray(value.automationRuns) && value.automationRuns.length <= 200 &&
      Array.isArray(value.discoveryQuestions) && value.discoveryQuestions.length <= 100 &&
      Array.isArray(value.discoveryAnswers) && value.discoveryAnswers.length <= 200 &&
      Array.isArray(value.decisions) && value.decisions.length <= 200 &&
      value.decisions.every((decision) => isRecord(decision) && Array.isArray(decision.relatedBranchIds)) &&
      isRecord(value.preferences) && isNonEmptyString(value.preferences.id, 200),
  );
}

function operatingSystemValidationError(
  operatingSystem: ProjectOperatingSystem,
  projectId: string,
  workspace?: ProjectWorkspace,
  legacyResearchFindingIds = new Set<string>(),
) {
  if (!isOperatingSystemShape(operatingSystem)) return "A valid operating-system update is required.";
  if (operatingSystem.viewport !== undefined && !isValidCanvasViewport(operatingSystem.viewport)) {
    return "Canvas viewport values must be finite numbers within safe bounds.";
  }
  if (operatingSystem.canvasViewport !== undefined && !isValidCanvasViewport(operatingSystem.canvasViewport)) {
    return "Canvas viewport values must be finite numbers within safe bounds.";
  }

  const branchIds = new Set<string>();
  for (const branch of operatingSystem.branches) {
    if (branch.workspaceId !== projectId) return "Branch records must belong to the project being updated.";
    if (branchIds.has(branch.id)) return "Branch ids must be unique within a project.";
    if (branch.canvasPosition !== undefined && !isValidCanvasPosition(branch.canvasPosition)) {
      return "Canvas branch positions must be finite numbers within safe bounds.";
    }
    branchIds.add(branch.id);
  }

  for (const branch of operatingSystem.branches) {
    const parent = branch.parentBranchId
      ? operatingSystem.branches.find((candidate) => candidate.id === branch.parentBranchId)
      : undefined;
    if (branch.parentBranchId && (!parent || parent.workspaceId !== projectId || branch.parentBranchId === branch.id)) {
      return "Nested branches must reference another branch in the same project.";
    }
    const seen = new Set<string>();
    let parentId = branch.parentBranchId;
    while (parentId) {
      if (seen.has(parentId)) return "Nested branch relationships cannot contain a cycle.";
      seen.add(parentId);
      parentId = operatingSystem.branches.find((candidate) => candidate.id === parentId)?.parentBranchId;
    }
  }

  for (const edge of operatingSystem.edges) {
    if (!branchIds.has(edge.fromBranchId) || !branchIds.has(edge.toBranchId) || edge.fromBranchId === edge.toBranchId) {
      return "Branch relationships must connect branches in the same project.";
    }
  }

  const taskIds = new Set(operatingSystem.tasks.map((task) => task.id));
  const milestoneIds = new Set(operatingSystem.milestones.map((milestone) => milestone.id));
  const decisionIds = new Set(operatingSystem.decisions.map((decision) => decision.id));
  for (const task of operatingSystem.tasks) {
    if (!branchIds.has(task.branchId)) return "Task records must belong to a branch in the same project.";
    if (!Array.isArray(task.dependencyIds) || task.dependencyIds.some((dependencyId) => !taskIds.has(dependencyId))) {
      return "Task dependency references must resolve within the project.";
    }
    if (!Array.isArray(task.blockedBy) || task.blockedBy.some((blockedTaskId) => !taskIds.has(blockedTaskId))) {
      return "Task blocked-by references must resolve within the project.";
    }
    if (task.milestoneId && !milestoneIds.has(task.milestoneId)) {
      return "Task milestone references must resolve within the project.";
    }
  }
  for (const branch of operatingSystem.branches) {
    if (branch.taskIds?.some((taskId) => !taskIds.has(taskId))) return "Branch task references must resolve within the project.";
    if (branch.decisionIds?.some((decisionId) => !decisionIds.has(decisionId))) return "Branch decision references must resolve within the project.";
  }

  for (const milestone of operatingSystem.milestones) {
    if (!branchIds.has(milestone.branchId)) return "Milestone records must belong to a branch in the same project.";
    if (!Array.isArray(milestone.taskIds) || milestone.taskIds.some((taskId) => !taskIds.has(taskId))) {
      return "Milestone task references must resolve within the project.";
    }
  }

  for (const decision of operatingSystem.decisions) {
    if (decision.relatedBranchIds.some((relatedBranchId) => !branchIds.has(relatedBranchId))) {
      return "Decision branch references must resolve within the project.";
    }
  }

  if (workspace) {
    const findingIds = new Set(workspace.researchFindings.map((finding) => finding.id));
    for (const branch of operatingSystem.branches) {
      if (branch.researchFindingIds?.some((findingId) => !findingIds.has(findingId) && !legacyResearchFindingIds.has(findingId))) {
        return "Branch research references must resolve to evidence owned by the project.";
      }
    }
  }

  return null;
}

function legacyResearchFindingIdsFor(workspace: ProjectWorkspace) {
  const branches = workspace.operatingSystem?.branches;
  return new Set(
    Array.isArray(branches) ? branches.flatMap((branch) => Array.isArray(branch.researchFindingIds) ? branch.researchFindingIds : []) : [],
  );
}

function mergeRecords<T extends { id: string }>(current: T[], incoming: T[]) {
  const currentRecords = Array.isArray(current) ? current : [];
  const incomingIds = new Set(incoming.map((record) => record.id));
  return [...currentRecords.filter((record) => !incomingIds.has(record.id)), ...incoming];
}

function mergeBranches(current: ProjectOperatingSystem["branches"], incoming: ProjectOperatingSystem["branches"]) {
  const currentBranches = Array.isArray(current) ? current : [];
  const currentById = new Map(currentBranches.map((branch) => [branch.id, branch]));
  const incomingIds = new Set(incoming.map((branch) => branch.id));
  const updated = incoming.map((branch) => ({
    ...(currentById.get(branch.id) ?? {}),
    ...branch,
  }));
  return [...currentBranches.filter((branch) => !incomingIds.has(branch.id)), ...updated];
}

function mergeOperatingSystem(
  current: ProjectOperatingSystem | undefined,
  incoming: ProjectOperatingSystem,
  deletedBranchIds: string[] = [],
): ProjectOperatingSystem {
  if (!current) {
    let initial = incoming;
    for (const branchId of deletedBranchIds) initial = removeBranchTree(initial, branchId);
    return initial;
  }
  const incomingBranchImpactSuggestions = Array.isArray(incoming.branchImpactSuggestions)
    ? incoming.branchImpactSuggestions
    : [];
  const incomingViewport = incoming.viewport ?? incoming.canvasViewport;
  const currentViewport = current.viewport ?? current.canvasViewport;
  let merged: ProjectOperatingSystem = {
    ...current,
    ...incoming,
    ...(incomingViewport !== undefined
      ? { viewport: incomingViewport }
      : currentViewport !== undefined ? { viewport: currentViewport } : {}),
    branches: mergeBranches(current.branches, incoming.branches),
    edges: mergeRecords(current.edges, incoming.edges),
    tasks: mergeRecords(current.tasks, incoming.tasks),
    milestones: mergeRecords(current.milestones, incoming.milestones),
    automations: mergeRecords(current.automations, incoming.automations),
    automationRuns: mergeRecords(current.automationRuns, incoming.automationRuns),
    discoveryQuestions: mergeRecords(current.discoveryQuestions, incoming.discoveryQuestions),
    discoveryAnswers: mergeRecords(current.discoveryAnswers, incoming.discoveryAnswers),
    decisions: mergeRecords(current.decisions, incoming.decisions),
    branchImpactSuggestions: incomingBranchImpactSuggestions.length
      ? incomingBranchImpactSuggestions
      : Array.isArray(current.branchImpactSuggestions) ? current.branchImpactSuggestions : [],
  };

  // The regular merge is intentionally additive so a delayed branch-chat or
  // canvas response cannot erase newer records. Explicit deletion ids are the
  // narrow exception that lets a user delete an otherwise empty branch tree
  // without allowing a stale snapshot to resurrect it on the next reload.
  for (const branchId of deletedBranchIds) merged = removeBranchTree(merged, branchId);
  return merged;
}

export function parseOperatingSystemInput(value: unknown): ProjectOperatingSystem | null {
  if (!isOperatingSystemShape(value)) return null;
  return value;
}

export async function updateOwnedProjectOperatingSystem(
  projectId: string,
  ownerUserId: string,
  operatingSystem: ProjectOperatingSystem,
  deletedBranchIds: string[] = [],
) {
  if (!isOperatingSystemShape(operatingSystem)) {
    throw new RepositoryError("invalid-input", "A valid operating-system update is required.");
  }
  if (
    !Array.isArray(deletedBranchIds) ||
    deletedBranchIds.length > 100 ||
    deletedBranchIds.some((branchId) => typeof branchId !== "string" || branchId.trim().length === 0 || branchId.length > 200)
  ) {
    throw new RepositoryError("invalid-input", "The deleted branch ids are invalid.");
  }
  const incomingValidationError = operatingSystem.branches.some((branch) => branch.workspaceId !== projectId)
    ? "Branch records must belong to the project being updated."
    : null;
  if (incomingValidationError) throw new RepositoryError("invalid-input", incomingValidationError);
  return mutateDatabase((database) => {
    const project = database.projects.find(
      (candidate) => candidate.id === projectId && candidate.ownerUserId === ownerUserId,
    );
    if (!project) return null;
    const mergedOperatingSystem = mergeOperatingSystem(project.workspace.operatingSystem, operatingSystem, deletedBranchIds);
    const legacyResearchFindingIds = legacyResearchFindingIdsFor(project.workspace);
    const validationError = operatingSystemValidationError(mergedOperatingSystem, projectId, project.workspace, legacyResearchFindingIds);
    if (validationError) throw new RepositoryError("invalid-input", validationError);
    const normalizedWorkspace = ensureOperatingSystem({
      ...project.workspace,
      operatingSystem: mergedOperatingSystem,
    });
    const normalizedOperatingSystem = normalizedWorkspace.operatingSystem;
    if (!normalizedOperatingSystem) throw new RepositoryError("invalid-input", "A valid operating-system update is required.");
    project.workspace = {
      ...normalizedWorkspace,
      operatingSystem: normalizedOperatingSystem,
      updatedAt: now(),
    };
    project.updatedAt = project.workspace.updatedAt;
    return project;
  });
}

/** Idempotent by anonymous draft id: a repeated attach returns the original project. */
export async function attachAnonymousDraftToUser(draftId: string, userId: string) {
  const snapshot = await readServerDatabase();
  const snapshotDraft = snapshot.anonymousIdeaDrafts.find((candidate) => candidate.id === draftId);
  if (!snapshotDraft) throw new RepositoryError("not-found", "The anonymous draft was not found.");
  if (snapshotDraft.attachedUserId && snapshotDraft.attachedUserId !== userId) {
    throw new RepositoryError("draft-attached", "The anonymous draft has already been attached.");
  }
  const preparedProject = snapshotDraft.attachedProjectId
    ? null
    : await enhanceOwnedProjectPlan(projectFromDraft(snapshotDraft, userId));

  return mutateDatabase(async (database) => {
    const draft = database.anonymousIdeaDrafts.find((candidate) => candidate.id === draftId);
    if (!draft) throw new RepositoryError("not-found", "The anonymous draft was not found.");
    if (draft.attachedUserId && draft.attachedUserId !== userId) throw new RepositoryError("draft-attached", "The anonymous draft has already been attached.");
    if (draft.attachedProjectId) {
      return database.projects.find((project) => project.id === draft.attachedProjectId) || null;
    }
    const preparedRequestMatches = preparedProject && JSON.stringify(preparedProject.workspace.request) === JSON.stringify(draft.request);
    const project = preparedRequestMatches
      ? { ...preparedProject, ownerUserId: userId }
      : projectFromDraft(draft, userId);
    database.projects.push(project);
    draft.attachedUserId = userId;
    draft.attachedProjectId = project.id;
    draft.updatedAt = now();
    return project;
  });
}
