import { NextResponse } from "next/server";

import { generateSolutionPlan } from "@/lib/recommendations";
import { isProjectRequest } from "@/lib/project-request";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const candidate = typeof body === "object" && body !== null && "request" in body ? body.request : body;
    if (!isProjectRequest(candidate)) {
      return NextResponse.json({ error: "A valid normalized project request is required." }, { status: 400 });
    }

    return NextResponse.json({
      provenance: "deterministic-catalogue",
      plan: generateSolutionPlan(candidate),
    });
  } catch {
    return NextResponse.json({ error: "The plan request could not be processed safely." }, { status: 400 });
  }
}
