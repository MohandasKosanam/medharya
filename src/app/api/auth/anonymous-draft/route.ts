import { NextResponse } from "next/server";

import {
  parseProjectRequestInput,
  RepositoryError,
  saveAnonymousIdeaDraft,
  attachAnonymousDraftToUser,
  getCurrentUser,
} from "@/lib/server/repository";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "A project draft is required." }, { status: 400 });
    }

    const projectRequest = parseProjectRequestInput(body);
    const requestedId = body.anonymousDraftId ?? body.draftId ?? body.id;
    if (!projectRequest || (requestedId !== undefined && typeof requestedId !== "string")) {
      return NextResponse.json({ error: "A valid project request is required." }, { status: 400 });
    }

    const draft = await saveAnonymousIdeaDraft(projectRequest, requestedId);
    const user = await getCurrentUser();
    const project = user ? await attachAnonymousDraftToUser(draft.id, user.id) : null;
    return NextResponse.json({ draft, project: project?.workspace ?? null }, { status: 200 });
  } catch (error) {
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The anonymous draft could not be saved safely." }, { status: 400 });
  }
}
