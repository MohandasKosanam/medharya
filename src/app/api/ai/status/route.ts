import { NextResponse } from "next/server";

import { getConfiguredModelProvider, selectedModelProviderStatus } from "@/lib/providers/openai-compatible";
import { getCurrentUser, getOwnedProject } from "@/lib/server/repository";

const MAX_PROJECT_ID_LENGTH = 200;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() ?? "";
  if (!projectId || projectId.length > MAX_PROJECT_ID_LENGTH) {
    return NextResponse.json({ error: "A valid project id is required." }, { status: 400 });
  }
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const provider = getConfiguredModelProvider();
  if (!provider) {
    return NextResponse.json({
      providerStatus: selectedModelProviderStatus(),
      checkedAt: new Date().toISOString(),
    });
  }

  if (typeof provider.health === "function") {
    await provider.health();
  }
  const providerStatus = provider.getStatus?.() ?? {
    provider: provider.name,
    model: provider.model,
    state: "configured" as const,
    identityVerified: false,
  };
  return NextResponse.json({ providerStatus, checkedAt: new Date().toISOString() });
}
