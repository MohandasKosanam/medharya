import { NextResponse } from "next/server";

import {
  parseProjectRequestInput,
  RepositoryError,
  saveAnonymousIdeaDraft,
  attachAnonymousDraftToUser,
  getCurrentUser,
  isRepositoryUnavailable,
} from "@/lib/server/repository";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/server/request";

const MAX_REQUEST_BYTES = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await readJsonBody(request, MAX_REQUEST_BYTES);
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
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError && error.code === "invalid-input") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "The anonymous draft could not be saved safely." }, { status: 400 });
  }
}
