import { NextResponse } from "next/server";

import { normalizeResearchUrl } from "@/lib/research/evidence";
import { runResearchQuery } from "@/lib/research/service";
import { appendBranchMessage, ensureOperatingSystem } from "@/lib/operating-system";
import {
  getCurrentUser,
  getOwnedProject,
  RepositoryError,
  updateOwnedProjectWorkspace,
  isRepositoryUnavailable,
} from "@/lib/server/repository";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/server/request";
import { appendResearchBundle, appendWorkspaceMessage, createStableId } from "@/lib/workspace";
import type { ResearchResponse } from "@/types/research";
import type { WorkspaceMessage } from "@/types/workspace";

const MAX_PROJECT_ID_LENGTH = 200;
const MAX_BRANCH_ID_LENGTH = 200;
const MAX_REQUEST_BYTES = 32_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function persistResearch(
  projectId: string,
  userId: string,
  branchId: string | undefined,
  response: ResearchResponse,
) {
  const updated = await updateOwnedProjectWorkspace(projectId, userId, (currentWorkspace) => {
    const normalizedWorkspace = ensureOperatingSystem(currentWorkspace);
    const next = appendResearchBundle(normalizedWorkspace, {
      findings: response.findings,
      sources: response.sources,
      evidence: response.evidence,
      claims: response.claims,
      assessment: response.assessment,
    });
    const responseFindingIds = new Set(response.findings.map((finding) => finding.id));
    const responseFindingUrls = new Set(response.findings.map((finding) => normalizeResearchUrl(finding.url)).filter((url): url is string => Boolean(url)));
    const persistedFindingIds = next.researchFindings
      .filter((finding) => {
        const normalizedUrl = normalizeResearchUrl(finding.url);
        return responseFindingIds.has(finding.id) || (normalizedUrl ? responseFindingUrls.has(normalizedUrl) : false);
      })
      .map((finding) => finding.id);
    const withBranchReferences = !branchId || !next.operatingSystem
      ? next
      : {
          ...next,
          operatingSystem: {
            ...next.operatingSystem,
            branches: next.operatingSystem.branches.map((branch) =>
              branch.id === branchId
                  ? {
                      ...branch,
                    researchFindingIds: [...new Set([...branch.researchFindingIds, ...persistedFindingIds])].slice(-100),
                    updatedAt: next.updatedAt,
                  }
                : branch,
            ),
          },
        };
    const createdAt = new Date().toISOString();
    const researchMessage: WorkspaceMessage = {
      id: createStableId("research-message"),
      role: "assistant",
      content: response.summary ?? response.message,
      source: "web-researched",
      createdAt,
      ...(response.citations?.length
        ? {
            citations: response.citations.map((citation) => ({
              evidenceId: citation.evidenceId,
              sourceId: citation.sourceId,
              title: citation.title,
              url: citation.url,
              retrievedAt: citation.retrievedAt,
            })),
          }
        : {}),
    };
    return branchId && withBranchReferences.operatingSystem?.branches.some((branch) => branch.id === branchId)
      ? appendBranchMessage(withBranchReferences, branchId, researchMessage)
      : appendWorkspaceMessage(withBranchReferences, researchMessage);
  });
  return updated?.workspace ?? null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await readJsonBody(request, MAX_REQUEST_BYTES);
    const query = isRecord(body) && typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 3 || query.length > 300) {
      return NextResponse.json({ error: "Research queries must be between 3 and 300 characters." }, { status: 400 });
    }

    const projectId = isRecord(body) && typeof body.projectId === "string" ? body.projectId.trim() : "";
    const branchId = isRecord(body) && typeof body.branchId === "string" && body.branchId.trim() ? body.branchId.trim() : undefined;
    const requestedLimit = isRecord(body) && typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 5;
    if (projectId.length > MAX_PROJECT_ID_LENGTH || branchId && branchId.length > MAX_BRANCH_ID_LENGTH) {
      return NextResponse.json({ error: "The research context identifier is invalid." }, { status: 400 });
    }

    let userId: string | undefined;
    if (projectId) {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "Authentication is required for server-owned research." }, { status: 401 });
      const project = await getOwnedProject(projectId, user.id);
      if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      const workspace = ensureOperatingSystem(project.workspace);
      if (branchId && !workspace.operatingSystem?.branches.some((branch) => branch.id === branchId && branch.workspaceId === projectId)) {
        return NextResponse.json({ error: "The requested project branch was not found." }, { status: 400 });
      }
      userId = user.id;
    }

    const response = await runResearchQuery(query, {
      maxResultsPerSearch: requestedLimit,
    });
    if (response.status === "available" && projectId && userId) {
      const workspace = await persistResearch(projectId, userId, branchId, response);
      if (!workspace) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      return NextResponse.json({ ...response, workspace, contextSource: "server-owned" });
    }

    const status = response.status === "error" ? 502 : response.status === "unavailable" ? 503 : 200;
    return NextResponse.json({
      ...response,
      contextSource: projectId ? "server-owned" : "client-local-draft",
      ...(projectId ? {} : { notice: "This local draft research response was not persisted by the server." }),
    }, { status });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The research request could not be processed safely." }, { status: 400 });
  }
}
