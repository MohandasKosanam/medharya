import { NextResponse } from "next/server";

import {
  getCurrentUser,
  parseOperatingSystemInput,
  RepositoryError,
  updateOwnedProjectOperatingSystem,
  isRepositoryUnavailable,
} from "@/lib/server/repository";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

    const { projectId } = await context.params;
    if (!projectId || projectId.length > 200) {
      return NextResponse.json({ error: "The project id is invalid." }, { status: 400 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 1_500_000) {
      return NextResponse.json({ error: "The operating-system update is too large." }, { status: 413 });
    }
    const body: unknown = await request.json();
    const bodyRecord = typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
    const candidate = bodyRecord && "operatingSystem" in bodyRecord
      ? bodyRecord.operatingSystem
      : body;
    const deletedBranchIds = bodyRecord && "deletedBranchIds" in bodyRecord
      ? bodyRecord.deletedBranchIds
      : [];
    if (
      !Array.isArray(deletedBranchIds) ||
      deletedBranchIds.length > 100 ||
      deletedBranchIds.some((branchId) => typeof branchId !== "string" || branchId.trim().length === 0 || branchId.length > 200)
    ) {
      return NextResponse.json({ error: "The deleted branch ids are invalid." }, { status: 400 });
    }
    const operatingSystem = parseOperatingSystemInput(candidate);
    if (!operatingSystem) {
      return NextResponse.json({ error: "A valid operating-system update is required." }, { status: 400 });
    }

    const project = await updateOwnedProjectOperatingSystem(projectId, user.id, operatingSystem, deletedBranchIds);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project: project.workspace });
  } catch (error) {
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The operating-system update could not be processed safely." }, { status: 400 });
  }
}
