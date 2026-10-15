# Medharya AI

**Intelligence, Made Useful.**

Medharya is an AI-powered solution builder for turning an idea into a practical
technology direction, an explicit set of trade-offs, and a buildable roadmap.

The current implementation is a local-first product prototype with an optional
server-owned path. It creates a browser-persisted project workspace, keeps
structured project memory, loads authenticated project context on the server,
generates a deterministic catalogue baseline, and supports optional server-side
model and web-research providers without pretending that unavailable services
ran.

## Current capabilities

- Phase 1 responsive landing page and validated project brief.
- Stable project workspace URLs such as `/workspace/<project-id>`.
- Browser-local project persistence; no account, cloud sync, or database.
- Editable project brief with explicit save-and-regenerate behavior.
- Context-aware chat with a clear deterministic fallback when no model provider
  is configured or a configured provider times out, is rate-limited, rejects its
  credential, or returns invalid data.
- Server-side deterministic plan endpoint for inspecting and testing structured
  recommendation output.
- Curated technology catalogue with official links and intentionally unverified
  pricing metadata.
- Deterministic recommendation and roadmap engine that reacts to category,
  budget, experience, deployment, preferences, and requirements.
- Optional OpenAI-compatible server-side provider adapter with bounded prompts,
  normalized output, usage metadata, transient retries, and secret-safe errors.
- Optional Brave Search server-side research adapter with bounded public-page
  retrieval, redirect checks, content-type/size/time limits, and SSRF defenses.
- Evidence records link search snippets or retrieved page text to source IDs;
  claims and citations can only reference evidence captured by the server.
- Server-owned chat/research loads and persists the authenticated project rather
  than trusting a client-supplied project snapshot.
- Explicit provenance, source, uncertainty, and unavailable-provider states.
- Optional server-side anonymous-draft handoff, account signup/login, logout,
  expiring httpOnly sessions, and ownership-checked project routes.
- Structured project operating-system records for discovery questions, branches,
  branch conversations, task drafts, milestones, and manual-only automation
  dry runs.

This prototype does **not** claim live recommendations, current prices,
verified compatibility, deployment, or human-verified web research. When the
corresponding provider is configured, the UI marks model output, search
snippets, retrieved pages, and evidence-backed summaries separately.

## Requirements

- Node.js `22.14.0` (the version is pinned in `.nvmrc`).
- npm 10 or newer.

## Local setup

```bash
nvm use
npm ci
cp .env.example .env.local
```

On Windows PowerShell, copy the environment template with:

```powershell
Copy-Item .env.example .env.local
```

The environment file may remain blank for the deterministic local-first mode.
Never commit real credentials.

For the account-backed prototype, set `MEDHARYA_SERVER_DATA_FILE` to a writable
server path when the default `./data/medharya-server.json` is not appropriate.
The repository is intentionally single-instance file-backed storage; it is not a
production database or multi-instance session store.

## Run in development

```bash
npm run dev
```

Open <http://localhost:3000>.

## Run the production build locally

```bash
npm run build
npm start
```

The workspace route is intentionally allowed to block during its server shell
because the project record is loaded from browser storage after hydration.

## Verification

The single offline project check is:

```bash
make test
```

It runs:

```bash
npm run lint
tsc --noEmit
npm run build
```

For a running local server, the lightweight HTTP smoke check can be run with:

```bash
MEDHARYA_DISABLE_EXTERNAL_PROVIDERS=1 node scripts/phase2-smoke.mjs
```

To target another server:

```bash
MEDHARYA_BASE_URL=http://localhost:3002 MEDHARYA_DISABLE_EXTERNAL_PROVIDERS=1 node scripts/phase2-smoke.mjs
```

The complete smoke command is:

```bash
MEDHARYA_BASE_URL=http://localhost:3000 MEDHARYA_DISABLE_EXTERNAL_PROVIDERS=1 npm run test:smoke
```

It verifies the landing page, chat input validation, workspace route,
recommendation differentiation, explicit live-research availability states,
server-owned project chat persistence and idempotency, authentication
boundaries, and cross-user isolation. It does not require an external provider.

The provider adapter can be exercised against a local mock endpoint (including a
transient failure and retry) with:

```bash
npm run test:provider
```

This starts a temporary local production server and never contacts a real AI
provider or prints a credential.

The public-page retrieval guardrails (private-network blocking, redirect checks,
body limits, and HTML extraction) have a deterministic mocked check:

```bash
npm run test:research-safety
```

For a running production server, the next-phase ownership and operating-system
smoke check is:

```bash
MEDHARYA_BASE_URL=http://localhost:3000 node scripts/next-phase-smoke.mjs
```

It exercises anonymous draft capture, signup attachment, session lookup,
ownership-checked project reads and updates, operating-system persistence,
logout protection, and cross-user isolation. It uses a temporary generated
account and does not print credentials.

## Optional provider configuration

### Server-side model provider

Medharya supports an OpenAI-compatible chat-completions endpoint through:

```dotenv
MEDHARYA_AI_API_KEY=replace-me
MEDHARYA_AI_MODEL=replace-me
MEDHARYA_AI_BASE_URL=https://api.openai.com/v1
MEDHARYA_AI_TIMEOUT_MS=15000
```

The default base URL targets the official OpenAI API shape. A compatible
self-hosted or hosted endpoint can be supplied explicitly with
`MEDHARYA_AI_BASE_URL`.

Keys are read only in the server route at `/api/chat`. They are never included
in browser bundles or project-local storage. Prompts and outputs are bounded;
provider failures are normalized into missing-config, auth, rate-limit, timeout,
transient-error, or invalid-response states. The adapter retries bounded
transient failures once, then falls back to the deterministic catalogue
response with an explicit notice.

### Live research provider

Live search is implemented through the Brave Search API adapter:

```dotenv
BRAVE_SEARCH_API_KEY=replace-me
```

Without this key, `/api/research` returns an explicit unavailable response and
the workspace adds no citations. With it, the server stores bounded search
results as `search-snippet` evidence and attempts safe retrieval of up to three
public HTML/text pages. Retrieved page evidence is marked separately from a
snippet; failed or unsafe page retrieval never becomes a citation. Source-backed
claims remain unverified until a person reviews the source.

For offline smoke tests, set `MEDHARYA_DISABLE_EXTERNAL_PROVIDERS=1`. This
forces the standard routes to exercise deterministic/unavailable behavior even
if a developer shell happens to contain provider credentials.

## Docker

Build and run the production image:

```bash
docker build -t medharya .
docker run --rm -p 3000:3000 --env-file .env.local medharya
```

The `Dockerfile` uses the pinned Node.js runtime, installs dependencies from
`package-lock.json`, builds the Next.js application, and runs the production
server. No global packages or host credentials are required.

## Architecture

```text
src/
  app/
    api/chat/route.ts          server-side model boundary
    api/plan/route.ts          validated deterministic plan boundary
    api/research/route.ts      server-side research boundary
    api/auth/                  prototype account/session and anonymous handoff
    api/projects/[projectId]/  ownership-checked project operations
    workspace/[projectId]/     dedicated project workspace route
  catalog/
    data.ts                    curated tool records
    index.ts                   catalogue retrieval helpers
    types.ts                   catalogue contracts
  components/
    builder/                   Phase 1 brief and workspace creation
    workspace/                 chat, brief editor, plan, research, branches, tasks
    layout/                    shared brand, header, footer
  lib/
    assistant.ts               deterministic chat fallback
    recommendations.ts         rule-based plan generation
    workspace.ts               project memory and plan updates
    workspace-storage.ts       defensive browser persistence
    providers/                 server-side model adapter
    research/                  Brave adapter, safe retrieval, evidence, summaries
    server/repository.ts       file-backed auth/project repository boundary
  types/
    project.ts                 Phase 1 request contract
    workspace.ts               project and conversation memory
    solution.ts                structured plan contract
    research.ts                research source/evidence/claim/citation contracts
```

The browser owns early persistence so the prototype works without a database.
Authenticated project chat and research use the server repository as the source
of truth and update the browser as a cache. Local draft chat/research remains an
explicit compatibility path and is labelled as not server-persisted.
`ProjectWorkspace` and its storage adapter are deliberately separate from the UI
so a database can replace the file repository later without rewriting the
recommendation and conversation contracts.

## Data and security boundaries

- Browser local storage is not secure multi-user storage and is not cloud sync.
- Account-backed prototype records use a server-side JSON repository and opaque
  hashed httpOnly session tokens; this is not production-grade
  database infrastructure.
- Model and search keys are server-only environment variables.
- Incoming chat and research messages are length-limited and validated.
- Project chat and research ignore client workspace snapshots when an
  authenticated `projectId` is supplied; ownership is checked before loading or
  persisting context.
- Retrieved web content is treated as untrusted text; it cannot invoke tools or
  change project decisions. Page retrieval rejects local/private DNS targets,
  credentials in URLs, unsafe redirects, unsupported content, oversized bodies,
  and timeouts.
- Model citations are accepted only when their evidence IDs resolve to server-
  captured evidence; model-provided URLs are never promoted into citations.
- Important brief changes require an explicit user save action.
- No payments, authentication, deployment, unrestricted shell access, or
  arbitrary model tool execution is implemented.

## Known limitations

- No managed database, account provider, multi-instance deployment, or production
  scheduler. The account flow is a single-instance file-backed prototype with
  ownership checks.
- Catalogue links are curated but not live-verified in the repository.
- Pricing and free-tier metadata are deliberately not asserted as current.
- The deterministic fallback is useful for structured planning but is not an AI
  model and does not perform live research.
- A configured model provider receives the authenticated structured brief,
  branch context, bounded recent message window, and captured evidence on the
  server; model output is not automatically allowed to mutate the project brief
  or invoke privileged actions.
- Brave search and public-page retrieval are live network operations when
  enabled. They are bounded and source-linked, but they do not prove that a
  source is truthful or current.
- Scheduled automations are not enabled. Automation Studio currently records
  safe manual dry runs only; no background worker or recurring scheduler is
  claimed.

## Deployment

1. Pin Node.js with `.nvmrc` or use the included Dockerfile.
2. Run `npm ci` from the committed lockfile.
3. Configure provider keys only in the deployment secret manager if providers
   are wanted.
4. Run `npm run test` before deploying.
5. Run `npm run build` and start with `npm start`, or deploy the Docker image.
6. Keep the provider and research limits, data retention, and cost terms under
   review before exposing the prototype to real user data.
