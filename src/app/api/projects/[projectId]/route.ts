import { NextResponse } from "next/server";

import {
  getCurrentUser,
  getOwnedProject,
  parseWorkspaceRequestPatch,
  updateOwnedProject,
} from "@/lib/server/repository";

interface ProjectRouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_request: Request, context: ProjectRouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const { projectId } = await context.params;
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "The project id is invalid." }, { status: 400 });
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ project: project.workspace });
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const { projectId } = await context.params;
  if (!projectId || projectId.length > 200) return NextResponse.json({ error: "The project id is invalid." }, { status: 400 });

  try {
    const body: unknown = await request.json();
    const patch = parseWorkspaceRequestPatch(body);
    if (!patch) return NextResponse.json({ error: "A valid project request patch is required." }, { status: 400 });

    const project = await updateOwnedProject(projectId, user.id, patch);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project: project.workspace });
  } catch {
    return NextResponse.json({ error: "The project update could not be processed safely." }, { status: 400 });
  }
}
