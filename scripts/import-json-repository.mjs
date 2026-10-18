import { readFile } from "node:fs/promises";
import { Client } from "pg";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = optionValue("--source") ?? process.env.MEDHARYA_SERVER_DATA_FILE?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!sourcePath) {
  throw new Error("Pass --source <path-to-medharya-server.json> or set MEDHARYA_SERVER_DATA_FILE.");
}
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to the already-provisioned PostgreSQL database before importing.");
}

const raw = await readFile(sourcePath, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error("The source repository file is not valid JSON; no import was attempted.");
}

if (
  typeof parsed !== "object" ||
  parsed === null ||
  parsed.version !== 1 ||
  !Array.isArray(parsed.users) ||
  !Array.isArray(parsed.anonymousIdeaDrafts) ||
  !Array.isArray(parsed.projects) ||
  !Array.isArray(parsed.sessions)
) {
  throw new Error("The source repository file does not have the expected version-1 shape; no import was attempted.");
}

const { parseServerDatabase } = await import("../src/lib/server/repository.ts");
const database = parseServerDatabase(parsed);
const client = new Client({ connectionString: databaseUrl, application_name: "medharya-json-import" });
const imported = { users: 0, projects: 0, drafts: 0, sessions: 0 };

try {
  await client.connect();
  await client.query("SELECT to_regclass('public.users') AS table_name");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('medharya:repository'))");

  for (const user of database.users) {
    const result = await client.query(
      `INSERT INTO users (id, email, display_name, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.email, user.displayName, user.passwordHash, user.createdAt],
    );
    imported.users += result.rowCount ?? 0;
  }

  for (const project of database.projects) {
    const result = await client.query(
      `INSERT INTO projects (id, owner_user_id, workspace, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [project.id, project.ownerUserId, JSON.stringify(project.workspace), project.createdAt, project.updatedAt],
    );
    imported.projects += result.rowCount ?? 0;
  }

  for (const draft of database.anonymousIdeaDrafts) {
    const result = await client.query(
      `INSERT INTO anonymous_drafts
         (id, request, created_at, updated_at, expires_at, attached_user_id, attached_project_id)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
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
    imported.drafts += result.rowCount ?? 0;
  }

  for (const session of database.sessions) {
    const result = await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt],
    );
    imported.sessions += result.rowCount ?? 0;
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ source: sourcePath, imported }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
