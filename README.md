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
- Browser-local early persistence plus an account-backed repository that uses
  PostgreSQL when `DATABASE_URL` is configured and a local JSON file only for
  non-production/offline development and tests.
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
- Dedicated Medharya Alpha FastAPI provider path with server-side authentication,
  HTTPS enforcement, request IDs, health/status checks, concurrency limits, and
  model/adapter identity attestation when the service returns it.
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
  nested branch relationships, branch conversations, task drafts, milestones,
  and manual-only automation dry runs.
- An interactive browser-persisted SVG idea map with node selection, drag/pan,
  zoom controls, direct branch connections, and reviewable relationship edges.
- Server-aware branch chat and branch-scoped research context that can include
  the selected branch, its parent chain, and explicitly related branches.

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

For local/offline account-backed development, set `MEDHARYA_SERVER_DATA_FILE` to
a writable server path when the default `./data/medharya-server.json` is not
appropriate. The JSON repository is disabled when `NODE_ENV=production`.

For production account-backed persistence, set the server-only `DATABASE_URL`
and apply the committed schema before starting the app:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_initial.sql
```

To preserve an existing local JSON repository when moving to PostgreSQL, first
apply the schema and then run the one-time, idempotent import command. It only
inserts records whose IDs are not already present and rolls back on a conflict
or validation error:

```bash
DATABASE_URL=postgres://... npm run db:import-json -- --source ./data/medharya-server.json
```

The command prints counts and never prints passwords, session tokens, project
content, or database credentials. Do not run it against a production database
until the source and target have been backed up and reviewed.

If production starts without `DATABASE_URL`, repository-backed routes return a
typed storage-unavailable response with HTTP 503 instead of treating a missing
or unreadable filesystem as an empty database.

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
npm run test:repository
npm run lint
tsc --noEmit
npm run build
```

`test:repository` is an offline contract check. It exercises the local JSON
repository's draft, signup/attachment, session, project read/update, and
production-without-`DATABASE_URL` unavailable behavior; it does not require a
live PostgreSQL server.

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

The mocked adapter scripts use an isolated temporary JSON repository with
`MEDHARYA_REPOSITORY_TEST_MODE=1`; that explicit test-only switch is not a
production storage fallback.

The bounded research engine can also be checked offline without a search key:

```bash
npm run test:research-engine
```

The workspace chat automatically classifies clearly current, documentation,
comparison, and troubleshooting questions. When a question needs external
evidence, it attempts bounded research before generating the answer. If live
research is not configured or is unavailable, chat continues with an explicit
notice and does not present the deterministic or model response as web research.
Common credential-shaped values are redacted before a query is sent to an
external research provider or model summarizer.

The server-owned branch and cross-branch intelligence smoke check is:

```bash
MEDHARYA_BASE_URL=http://localhost:3000 MEDHARYA_DISABLE_EXTERNAL_PROVIDERS=1 node scripts/intelligence-smoke.mjs
```

It verifies nested branch persistence, canvas validation and deletion persistence,
project-boundary validation, branch chat routing and persistence, concurrent chat
idempotency, branch research references when research is available, and cross-user
chat isolation.

The provider adapter can be exercised against a local mock endpoint (including a
transient failure and retry) with:

```bash
npm run test:provider
```

This starts a temporary local production server and never contacts a real AI
provider or prints a credential.

The Alpha path can be exercised against a local mocked FastAPI service with:

```bash
npm run test:alpha-adapter
```

That check covers provider selection, health identity attestation, request
authentication and request IDs, input/output limits, malformed responses,
timeouts, fallback behavior, server-owned persistence, and idempotency. It is
mocked and is not evidence that a deployed Alpha service is reachable.

After a real Alpha service is deployed and its server-only variables are set,
run the opt-in live check against the running Medharya backend:

```bash
MEDHARYA_BASE_URL=https://your-medharya-host.example npm run test:alpha:live
```

The live check creates a temporary application account, calls the authenticated
status route, sends one real project chat message through `/api/chat`, verifies
the returned provider/model/adapter identity fields, and does not print prompt
content, response content, or credentials. It fails rather than falling back if
the running backend is not actually using `medharya-alpha`.

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

### Provider selection

The browser never calls a model service directly. The existing Next.js route
`POST /api/chat` loads the owned project context, selects one server-side
provider, validates the result, persists the conversation, and returns the
existing frontend response shape. This repository does not contain a separate
Express entry point; the App Router handlers are the current Node.js backend.

Set `MEDHARYA_AI_PROVIDER=alpha` to select Medharya Alpha. Leave it unset or
use `openai-compatible` to preserve the existing provider path.

Set `MEDHARYA_AI_PROVIDER=ollama` to use the locally installed Ollama model.
The browser still calls only Medharya's `/api/chat` route; Ollama is contacted
server-side over loopback.

### Local Ollama provider

The local provider targets the installed `qwen3:4b` model through Ollama's
non-streaming chat API:

```dotenv
MEDHARYA_AI_PROVIDER=ollama
MEDHARYA_OLLAMA_BASE_URL=http://127.0.0.1:11434
MEDHARYA_OLLAMA_MODEL=qwen3:4b
MEDHARYA_OLLAMA_TIMEOUT_MS=30000
```

`MEDHARYA_OLLAMA_BASE_URL` is the Ollama server root. The adapter sends the
request to `<base-url>/api/chat`, keeps `stream` and `think` disabled, bounds
generation to 900 tokens, and accepts only the visible
`message.content` field. Any `message.thinking` field or `<think>...</think>`
block in content is removed before the response reaches the frontend.

For safety, the adapter accepts only loopback HTTP URLs (`localhost`,
`127.0.0.1`, or `::1`) without credentials, query strings, or fragments. It
does not send an API key to Ollama. Provider failures preserve the existing
deterministic fallback and are reported as timeout, transient-error,
model-missing, or invalid-response states.

The Ollama status route performs a server-side `/api/tags` health check and
reports `ready` only when the daemon responds and the configured model is
installed. A stopped daemon or missing model is reported as unavailable. The
browser still receives only the existing `/api/ai/status` and `/api/chat`
response contracts.

On Windows PowerShell, start Ollama if it is not already running, confirm the
model is present, then start Medharya:

```powershell
ollama serve
ollama list
$env:MEDHARYA_AI_PROVIDER = "ollama"
$env:MEDHARYA_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:MEDHARYA_OLLAMA_MODEL = "qwen3:4b"
$env:MEDHARYA_OLLAMA_TIMEOUT_MS = "30000"
$env:MEDHARYA_DISABLE_EXTERNAL_PROVIDERS = "0"
npm run dev
```

If the Ollama desktop service is already running, do not start a second
`ollama serve` process. Do not expose port `11434` publicly.

To verify a real frontend request, open `http://localhost:3000`, create or
open an account-backed workspace, and send a chat message. The authenticated
`POST /api/chat` response should contain:

```json
{
  "source": "model-assisted",
  "provider": "ollama",
  "model": "qwen3:4b",
  "contextSource": "server-owned",
  "providerStatus": { "state": "ready" }
}
```

The browser continues to use the existing response shape and persistence path;
the local Ollama service is never called directly by the browser.

The mocked adapter regression suite is:

```bash
npm run test:ollama-adapter
```

It validates request bounds, thinking-content removal, usage normalization,
malformed output, timeout, unavailable-service fallback, status reporting, and
server-owned persistence without contacting the real Ollama daemon. A real
frontend/model request is established only by the manual flow above or the
opt-in live smoke command:

```powershell
npm run test:ollama:live
```

`test:ollama:live` starts a temporary production Medharya server, creates a
temporary account/project, sends one real `/api/chat` request to the configured
loopback Ollama service, verifies the model-assisted response and persistence,
prints metadata only, and removes its temporary server data. It does not use a
mock and does not start training.

### Medharya Alpha FastAPI provider

The dedicated Alpha adapter targets a configurable service with these defaults:

```dotenv
MEDHARYA_AI_PROVIDER=alpha
MEDHARYA_ALPHA_BASE_URL=https://your-private-alpha-host.example
MEDHARYA_ALPHA_API_KEY=replace-me
MEDHARYA_ALPHA_MODEL=medharya-alpha-v0.1
MEDHARYA_ALPHA_BASE_MODEL=Qwen3-8B
MEDHARYA_ALPHA_ADAPTER_VERSION=Medharya Alpha v0.1
MEDHARYA_ALPHA_HEALTH_PATH=/health
MEDHARYA_ALPHA_CHAT_PATH=/chat
MEDHARYA_ALPHA_TIMEOUT_MS=15000
MEDHARYA_ALPHA_MAX_CONCURRENT=4
MEDHARYA_ALPHA_MAX_OUTPUT_TOKENS=900
MEDHARYA_ALPHA_ALLOW_INSECURE_LOCAL=0
```

The adapter sends a server-side Bearer credential, `X-Request-ID`, and a
bounded JSON request:

```json
{
  "request_id": "server-generated-id",
  "message": "the latest user message",
  "system": "bounded system instructions",
  "context": "bounded project and evidence context",
  "history": [{"role": "user", "content": "bounded prior message"}],
  "max_new_tokens": 900
}
```

It accepts only a bounded text response from the top-level `response`, `reply`,
or `content` field. Optional response metadata is read from `model`,
`base_model`, and `adapter_version` (snake-case or camel-case variants).
`GET /health` must expose a readiness signal such as `ready: true`,
`model_loaded: true`, `status: "ready"`, or `ok: true`; returning matching model,
base-model, and adapter metadata is required to mark identity as verified.

These are the adapter's current contract assumptions, not a claim that the
historical Colab service still implements them. No Alpha URL, credential,
deployment, base-model load, adapter load, or live inference was discoverable in
this workspace at the time of this integration. Verify the actual FastAPI
schemas before enabling Alpha in production.

Remote Alpha URLs must use HTTPS. HTTP is accepted only for `localhost` or
`127.0.0.1` when `MEDHARYA_ALPHA_ALLOW_INSECURE_LOCAL=1`, and that exception is
for local testing only. The configured base model and adapter remain separate
configuration/artifact requirements; this integration never merges or modifies
model weights.

The authenticated status route is:

```text
GET /api/ai/status?projectId=<owned-project-id>
```

It performs a real Alpha health request when Alpha is configured. Its states are:

- `configured`: configuration is valid but no live check has established readiness.
- `connecting`: a health or inference check is currently in progress inside the backend.
- `ready`: a health check or inference succeeded; `identityVerified` is separate and
  is true only when the service attested to the configured identity fields.
- `degraded`: configuration existed or a prior check succeeded, but the latest
  check/inference failed, mismatched identity, or returned malformed data.
- `unavailable`: missing/invalid configuration, rejected credentials, or no
  reachable service has been established.

Alpha inference is not automatically retried because the service contract does
not yet document request-id idempotency for generation requests. Timeouts,
authentication failures, overload, and malformed responses return safe provider
status data and preserve the deterministic fallback.

### Existing OpenAI-compatible provider

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

### Runpod OpenAI-compatible worker

If the selected Runpod worker exposes the OpenAI-compatible chat-completions
contract, use the existing provider path; no Runpod-specific adapter or client
bundle code is required. Configure these variables in the server or deployment
secret manager:

```dotenv
MEDHARYA_AI_PROVIDER=openai-compatible
MEDHARYA_AI_API_KEY=replace-me
MEDHARYA_AI_MODEL=replace-me
MEDHARYA_AI_BASE_URL=https://your-worker-api.example/v1
MEDHARYA_AI_TIMEOUT_MS=45000
```

`MEDHARYA_AI_BASE_URL` must be the worker's documented API root or its full
`/chat/completions` URL. The adapter sends a server-side Bearer credential and
the standard `model`, `temperature`, `max_tokens`, and `messages` fields. It
accepts `choices[0].message.content` (or the compatible `choices[0].text`)
and optional token usage. When the response includes a `model` field, it must
match `MEDHARYA_AI_MODEL`; a matching response is marked identity-verified in
the chat provider status. A Runpod dashboard URL, endpoint ID without an API
URL, or a worker that only exposes raw Serverless `/run` and polling endpoints
does not satisfy this integration contract.

The existing bounded timeout, retry, prompt limits, safe error normalization,
and deterministic fallback apply unchanged. `npm run test:provider` verifies
this contract against a local mock only; it does not prove that a Runpod worker
is deployed or reachable. A genuine Runpod integration is established only
after these variables are configured in the running Medharya backend and an
authenticated `/api/chat` request returns `source: "model-assisted"` with
`provider: "openai-compatible"`.

The current Colab notebook uses this same OpenAI-compatible shape: its FastAPI
service exposes `GET /health` and `POST /v1/chat/completions`, requires a
server-side Bearer token, and returns the configured
`medharya-alpha-v0.1` model in the completion response. For that service, use
the OpenAI-compatible provider with `MEDHARYA_AI_BASE_URL` set to the stable
HTTPS service root plus `/v1` and `MEDHARYA_AI_MODEL=medharya-alpha-v0.1`.
The temporary Cloudflare URLs shown by Colab are not a production hosting
solution and must be treated as unavailable when they stop responding.

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
claims remain unverified until a person reviews the source. Research responses
also preserve bounded source-quality/freshness classifications, report missing
evidence such as undated or snippet-only results, and flag potentially
conflicting evidence for review rather than silently choosing a side.

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
    api/ai/status/route.ts     authenticated provider health/status boundary
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
    server/repository.ts       PostgreSQL/file auth and project repository boundary
  types/
    project.ts                 Phase 1 request contract
    workspace.ts               project and conversation memory
    solution.ts                structured plan contract
    research.ts                research source/evidence/claim/citation contracts
```

The browser owns early persistence so the deterministic local-first flow works
without a database. Authenticated project chat and research use the server
repository as the source of truth and update the browser as a cache. With
`DATABASE_URL`, the repository persists users, anonymous drafts, projects,
sessions, and JSON workspace payloads in PostgreSQL. Without it, only
non-production/offline runtimes use the JSON compatibility repository. Local
draft chat/research remains an explicit compatibility path and is labelled as
not server-persisted.
`ProjectWorkspace` and its storage adapter are deliberately separate from the UI
so the PostgreSQL and local JSON repository implementations share the same
recommendation and conversation contracts.

## Data and security boundaries

- Browser local storage is not secure multi-user storage and is not cloud sync.
- Account-backed records use opaque hashed httpOnly session tokens. Production
  records require the PostgreSQL repository and the committed schema; the JSON
  repository is limited to non-production/offline development and tests.
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
- No payments, production identity provider, deployment automation, unrestricted
  shell access, or arbitrary model tool execution is implemented.

## Known limitations

- No managed database, account provider, or production scheduler is included.
  PostgreSQL is supported through the server-only `DATABASE_URL` and committed
  schema; local JSON remains a single-instance compatibility repository.
- Catalogue links are curated but not live-verified in the repository.
- Pricing and free-tier metadata are deliberately not asserted as current.
- The deterministic fallback is useful for structured planning but is not an AI
  model and does not perform live research.
- A configured model provider receives the authenticated structured brief,
  branch context, bounded recent message window, and captured evidence on the
  server; model output is not automatically allowed to mutate the project brief
  or invoke privileged actions.
- Medharya Alpha v0.1 model weights, the Qwen3-8B base artifact, the QLoRA
  adapter, and a persistent GPU inference deployment are not present in this
  repository. The prior Google Colab result is historical evidence only; no
  current Alpha endpoint was discoverable or live-verified here.
- Brave search and public-page retrieval are live network operations when
  enabled. They are bounded and source-linked, but they do not prove that a
  source is truthful or current.
- Scheduled automations are not enabled. Automation Studio currently records
  safe manual dry runs only; no background worker or recurring scheduler is
  claimed.

## Deployment

1. Pin Node.js with `.nvmrc` or use the included Dockerfile.
2. Run `npm ci` from the committed lockfile.
3. Set the server-only `DATABASE_URL` to the PostgreSQL database and apply
   `db/migrations/001_initial.sql` with `psql`. Production must not rely on the
   local JSON repository.
4. For Alpha, deploy the Qwen3-8B base model and Medharya Alpha v0.1 QLoRA
   adapter as separate artifacts on a persistent, authenticated GPU service.
   The service must expose the `/health` and `/chat` contract documented above;
   Colab or a temporary tunnel is not a production deployment.
5. For a Runpod worker that exposes the OpenAI-compatible contract, configure
   `MEDHARYA_AI_PROVIDER`, `MEDHARYA_AI_API_KEY`, `MEDHARYA_AI_MODEL`, and
   `MEDHARYA_AI_BASE_URL` only in the deployment secret manager. Verify the
   worker's HTTPS URL, Bearer authentication, model name, and response schema
   before enabling it. A raw Runpod Serverless `/run` endpoint requires a
   separate adapter and is not enabled by this repository.
6. Configure Alpha provider keys and service variables only in the deployment
   secret manager. Use `MEDHARYA_AI_PROVIDER=alpha` only after the service
   health schema, model identity, adapter identity, and HTTPS/auth path are
   verified.
7. Run `npm run test` before deploying.
8. Run `npm run build` and start with `npm start`, or deploy the Docker image.
9. Run `MEDHARYA_BASE_URL=<backend> npm run test:alpha:live` only after the
   configured Alpha service is reachable. This is the evidence required for a
   genuine integration response; mocked tests do not substitute for it.
10. Keep the provider and research limits, data retention, and cost terms under
   review before exposing the prototype to real user data.
