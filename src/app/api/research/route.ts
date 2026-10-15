import { NextResponse } from "next/server";

import { createResearchClaim, citationsForEvidence } from "@/lib/research/evidence";
import { searchWithBrave } from "@/lib/research/brave";
import { summarizeResearchWithModel } from "@/lib/research/summary";
import { appendBranchMessage } from "@/lib/operating-system";
import {
  getCurrentUser,
  getOwnedProject,
  RepositoryError,
  updateOwnedProjectWorkspace,
} from "@/lib/server/repository";
import { appendResearchBundle, appendWorkspaceMessage, createStableId } from "@/lib/workspace";
import type { ResearchClaim, ResearchResponse } from "@/types/research";
import type { WorkspaceMessage } from "@/types/workspace";

const MAX_PROJECT_ID_LENGTH = 200;
const MAX_BRANCH_ID_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildEvidenceSummary(response: ResearchResponse): ResearchResponse {
  const evidence = response.evidence ?? [];
  const sources = response.sources ?? [];
  const claims: ResearchClaim[] = (response.findings ?? [])
    .map((finding) => {
      if (!finding.evidenceId) return null;
      const evidenceRecord = evidence.find((item) => item.id === finding.evidenceId);
      if (!evidenceRecord) return null;
      return createResearchClaim(evidenceRecord.text.slice(0, 520), [evidenceRecord.id], evidence);
    })
    .filter((claim): claim is ResearchClaim => Boolean(claim));
  const citations = citationsForEvidence(claims.flatMap((claim) => claim.evidenceIds), evidence, sources);
  const summary = claims.length
    ? [
        "Source-backed research summary (not human-verified):",
        ...claims.slice(0, 5).map((claim) => `• ${claim.text} [evidence:${claim.evidenceIds[0]}]`),
      ].join("\n")
    : undefined;
  return {
    ...response,
    ...(claims.length ? { claims } : {}),
    ...(citations.length ? { citations } : {}),
    ...(summary ? { summary, summarySource: "deterministic-evidence" as const } : {}),
  };
}

async function persistResearch(
  projectId: string,
  userId: string,
  branchId: string | undefined,
  response: ResearchResponse,
) {
  const updated = await updateOwnedProjectWorkspace(projectId, userId, (currentWorkspace) => {
    const next = appendResearchBundle(currentWorkspace, {
      findings: response.findings,
      sources: response.sources,
      evidence: response.evidence,
      claims: response.claims,
    });
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
                    researchFindingIds: [...new Set([...branch.researchFindingIds, ...response.findings.map((finding) => finding.id)])].slice(-100),
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
    const body: unknown = await request.json();
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
      if (branchId && !project.workspace.operatingSystem?.branches.some((branch) => branch.id === branchId)) {
        return NextResponse.json({ error: "The requested project branch was not found." }, { status: 400 });
      }
      userId = user.id;
    }

    const response = await summarizeResearchWithModel(query, buildEvidenceSummary(await searchWithBrave(query, requestedLimit)));
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
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The research request could not be processed safely." }, { status: 400 });
  }
}
