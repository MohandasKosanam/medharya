# Medharya AI

**Intelligence, Made Useful.**

Medharya is an AI-powered solution builder for turning an idea into a practical
technology direction, an explicit set of trade-offs, and a buildable roadmap.

The current Phase 2 implementation is a local-first prototype. It creates a
browser-persisted project workspace, keeps structured project memory, provides a
context-aware conversation, generates a deterministic catalogue baseline, and
supports optional server-side model and web-research providers.

## Current capabilities

- Phase 1 responsive landing page and validated project brief.
- Stable project workspace URLs such as `/workspace/<project-id>`.
- Browser-local project persistence; no account, cloud sync, or database.
- Editable project brief with explicit save-and-regenerate behavior.
- Context-aware chat with a clear deterministic fallback when no model provider
  is configured.
- Server-side deterministic plan endpoint for inspecting and testing structured
  recommendation output.
- Curated technology catalogue with official links and intentionally unverified
  pricing metadata.
- Deterministic recommendation and roadmap engine that reacts to category,
  budget, experience, deployment, preferences, and requirements.
- Optional OpenAI-compatible server-side provider adapter.
- Optional Brave Search server-side research adapter.
- Explicit provenance, source, uncertainty, and unavailable-provider states.
- Optional server-side anonymous-draft handoff, account signup/login, logout,
  expiring httpOnly sessions, and ownership-checked project routes.
- Structured project operating-system records for discovery questions, branches,
  branch conversations, task drafts, milestones, and manual-only automation
  dry runs.

This prototype does **not** claim live recommendations, current prices,
verified compatibility, deployment, or web research unless the corresponding
provider is configured and the UI marks the result as available.

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
node scripts/phase2-smoke.mjs
```

To target another server:

```bash
MEDHARYA_BASE_URL=http://localhost:3002 node scripts/phase2-smoke.mjs
```

The smoke check verifies the landing page, chat input validation, and the
workspace route, recommendation differentiation, and the explicit live-research
available/unavailable response. It does not require an external provider.

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
in browser bundles or project-local storage. Provider failures, timeouts, rate
limits, missing configuration, and invalid responses fall back to the
deterministic catalogue response with an explicit notice.

### Live research provider

Live search is implemented through the Brave Search API adapter:

```dotenv
BRAVE_SEARCH_API_KEY=replace-me
```

Without this key, `/api/research` returns an explicit unavailable response and
the workspace adds no citations. With it, retrieved results are stored in the
local project record as `retrieved-not-yet-verified` evidence. Medharya does not
pretend that a search result is a verified recommendation.

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
    research/                  server-side Brave adapter
    server/repository.ts       file-backed auth/project repository boundary
  types/
    project.ts                 Phase 1 request contract
    workspace.ts               project and conversation memory
    solution.ts                structured plan contract
    research.ts                research evidence contract
```

The browser owns early persistence so the prototype works without a database.
`ProjectWorkspace` and its storage adapter are deliberately separate from the
UI so a server repository can replace local storage later without rewriting the
recommendation and conversation contracts.

## Data and security boundaries

- Browser local storage is not secure multi-user storage and is not cloud sync.
- Account-backed prototype records use a server-side JSON repository and opaque
  hashed httpOnly session tokens; this is not production-grade
  database infrastructure.
- Model and search keys are server-only environment variables.
- Incoming chat and research messages are length-limited and validated.
- Retrieved web content is treated as untrusted text; it cannot invoke tools or
  change project decisions.
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
- A configured model provider receives the structured brief and recent message
  window on the server; model output is not automatically allowed to mutate the
  project brief or invoke privileged actions.
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
