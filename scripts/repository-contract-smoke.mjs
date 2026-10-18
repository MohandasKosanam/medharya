import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repository = await import("../src/lib/server/repository.ts");

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
  POSTGRES_URL: process.env.POSTGRES_URL,
  medharya_POSTGRES_PRISMA_URL: process.env.medharya_POSTGRES_PRISMA_URL,
  medharya_POSTGRES_URL_NON_POOLING: process.env.medharya_POSTGRES_URL_NON_POOLING,
  MEDHARYA_SERVER_DATA_FILE: process.env.MEDHARYA_SERVER_DATA_FILE,
  MEDHARYA_REPOSITORY_TEST_MODE: process.env.MEDHARYA_REPOSITORY_TEST_MODE,
};
const temporaryDirectory = await mkdtemp(join(tmpdir(), "medharya-repository-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

try {
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.POSTGRES_URL;
  delete process.env.medharya_POSTGRES_PRISMA_URL;
  delete process.env.medharya_POSTGRES_URL_NON_POOLING;
  process.env.MEDHARYA_SERVER_DATA_FILE = join(temporaryDirectory, "server.json");
  process.env.MEDHARYA_REPOSITORY_TEST_MODE = "1";

  assert(repository.getRepositoryBackend() === "json", "Non-production without DATABASE_URL must use the local JSON repository.");

  const draft = await repository.saveAnonymousIdeaDraft({
    idea: "Build a small student travel planner",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Beginner",
    preferredTechnologies: ["Python"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Keep the first version simple.",
    submittedAt: new Date().toISOString(),
  });
  assert(typeof draft.id === "string", "The JSON repository must return a draft id.");

  const signup = await repository.registerUser({
    email: "repository-contract@example.com",
    password: "contract-password-123",
    displayName: "Repository Contract",
    anonymousDraftId: draft.id,
  });
  assert(signup.project?.ownerUserId === signup.user.id, "Signup must attach the anonymous draft to the new user.");

  const sessionUser = await repository.findUserBySessionToken(signup.token);
  assert(sessionUser?.id === signup.user.id, "A created session must resolve to its user.");

  const loadedProject = await repository.getOwnedProject(signup.project.id, signup.user.id);
  assert(loadedProject?.workspace.request.idea === "Build a small student travel planner", "The attached project must round-trip through the repository.");

  const updatedProject = await repository.updateOwnedProject(signup.project.id, signup.user.id, {
    additionalRequirements: "The first release must explain its assumptions.",
  });
  assert(updatedProject?.workspace.request.additionalRequirements.includes("assumptions"), "Owned project updates must persist through the repository contract.");

  await repository.revokeSessionToken(signup.token);
  assert((await repository.findUserBySessionToken(signup.token)) === null, "Revoked sessions must no longer authenticate.");

  const loginDraft = await repository.saveAnonymousIdeaDraft({
    idea: "Build a small offline study planner",
    category: "AI application",
    budgetInr: 0,
    experienceLevel: "Beginner",
    preferredTechnologies: [],
    deploymentPreference: "Local development only",
    additionalRequirements: "Keep the study plan private.",
    submittedAt: new Date().toISOString(),
  });
  const sessionsBeforeFailedLogin = (await repository.readServerDatabase()).sessions.length;
  let failedLogin = false;
  try {
    await repository.authenticateUserAndCreateSession({
      email: "repository-contract@example.com",
      password: "contract-password-123",
      anonymousDraftId: "draft_missing_for_atomic_login",
    });
  } catch (error) {
    failedLogin = error instanceof repository.RepositoryError && error.code === "not-found";
  }
  assert(failedLogin, "Login with a missing handoff draft must fail before creating a session.");
  assert((await repository.readServerDatabase()).sessions.length === sessionsBeforeFailedLogin, "Failed draft attachment must not leave a persisted login session.");

  const login = await repository.authenticateUserAndCreateSession({
    email: "repository-contract@example.com",
    password: "contract-password-123",
    anonymousDraftId: loginDraft.id,
  });
  assert(login.project?.ownerUserId === login.user.id, "Atomic login must attach the handoff draft before returning a session.");
  assert((await repository.findUserBySessionToken(login.token))?.id === login.user.id, "Atomic login session must resolve to its user.");
  await repository.revokeSessionToken(login.token);

  for (const recordKey of ["users", "anonymousIdeaDrafts", "projects", "sessions"]) {
    let rejectedMalformedSnapshot = false;
    try {
      repository.parseServerDatabase({
        version: 1,
        users: [],
        anonymousIdeaDrafts: [],
        projects: [],
        sessions: [],
        [recordKey]: [null],
      });
    } catch (error) {
      rejectedMalformedSnapshot = error instanceof repository.RepositoryError && error.code === "unavailable";
    }
    assert(rejectedMalformedSnapshot, `Snapshot parsing must reject an unrecognized ${recordKey} record instead of dropping it.`);
  }

  const expiredSnapshot = repository.parseServerDatabase({
    version: 1,
    users: [],
    anonymousIdeaDrafts: [{
      id: "expired-draft",
      request: {
        idea: "Build a small offline study planner",
        category: "AI application",
        budgetInr: 0,
        experienceLevel: "Beginner",
        preferredTechnologies: [],
        deploymentPreference: "Local development only",
        additionalRequirements: "",
        submittedAt: "2020-01-01T00:00:00.000Z",
      },
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
      attachedUserId: null,
      attachedProjectId: null,
    }],
    projects: [],
    sessions: [],
  });
  assert(expiredSnapshot.anonymousIdeaDrafts.length === 0, "Expired drafts must retain their intentional expiry behavior.");

  await writeFile(process.env.MEDHARYA_SERVER_DATA_FILE, "not-json", "utf8");
  let rejectedMalformedFile = false;
  try {
    await repository.readServerDatabase();
  } catch (error) {
    rejectedMalformedFile = error instanceof repository.RepositoryError && error.code === "unavailable";
  }
  assert(rejectedMalformedFile, "Malformed JSON storage must fail closed instead of becoming an empty database.");

  process.env.DATABASE_URL = "postgres://offline-contract.invalid/medharya";
  assert(repository.getRepositoryBackend() === "postgres", "DATABASE_URL must select the PostgreSQL repository without exposing it to the client.");

  delete process.env.DATABASE_URL;
  process.env.medharya_POSTGRES_PRISMA_URL = "postgres://offline-contract.invalid/vercel-integration";
  assert(repository.getRepositoryBackend() === "postgres", "The connected Vercel PostgreSQL URL must select the PostgreSQL repository.");

  delete process.env.medharya_POSTGRES_PRISMA_URL;
  process.env.POSTGRES_PRISMA_URL = "postgres://offline-contract.invalid/vercel-unprefixed-integration";
  assert(repository.getRepositoryBackend() === "postgres", "The unprefixed Vercel PostgreSQL URL must select the PostgreSQL repository.");

  process.env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.POSTGRES_URL;
  delete process.env.medharya_POSTGRES_PRISMA_URL;
  delete process.env.medharya_POSTGRES_URL_NON_POOLING;
  assert(repository.getRepositoryBackend() === "unavailable", "Production without DATABASE_URL must be unavailable.");
  let unavailable = false;
  try {
    await repository.readServerDatabase();
  } catch (error) {
    unavailable = error instanceof repository.RepositoryError && error.code === "unavailable";
  }
  assert(unavailable, "Production without DATABASE_URL must raise the typed unavailable repository error.");

  console.log("repository contract smoke passed");
} finally {
  restoreEnvironment();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
