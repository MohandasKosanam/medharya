import { NextResponse } from "next/server";

import { generateServerSolutionPlan } from "@/lib/server/recommendations";
import { isProjectRequest } from "@/lib/project-request";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const candidate = typeof body === "object" && body !== null && "request" in body ? body.request : body;
    if (!isProjectRequest(candidate)) {
      return NextResponse.json({ error: "A valid normalized project request is required." }, { status: 400 });
    }

    const result = await generateServerSolutionPlan(candidate);
    return NextResponse.json({
      provenance: result.plan.provenance,
      plan: result.plan,
      providerStatus: result.providerStatus,
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.model ? { model: result.model } : {}),
      ...(result.usedFallback ? { fallback: true, fallbackReason: result.reason ?? "provider-unavailable" } : { fallback: false }),
    });
  } catch {
    return NextResponse.json({ error: "The plan request could not be processed safely." }, { status: 400 });
  }
}
