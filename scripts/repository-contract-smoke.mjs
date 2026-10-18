import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repository = await import("../src/lib/server/repository.ts");

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  MEDHARYA_SERVER_DATA_FILE: process.env.MEDHARYA_SERVER_DATA_FILE,
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
  process.env.MEDHARYA_SERVER_DATA_FILE = join(temporaryDirectory, "server.json");

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

  process.env.DATABASE_URL = "postgres://offline-contract.invalid/medharya";
  assert(repository.getRepositoryBackend() === "postgres", "DATABASE_URL must select the PostgreSQL repository without exposing it to the client.");

  process.env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;
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
