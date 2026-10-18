import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME,
  clearAnonymousDraftHandoffCookie,
  getCurrentUser,
  parseProjectRequestInput,
  RepositoryError,
  saveAnonymousIdeaDraft,
  setAnonymousDraftHandoffCookie,
  attachAnonymousDraftToUser,
  isRepositoryUnavailable,
  toPublicAnonymousDraft,
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
    if (!projectRequest) {
      return NextResponse.json({ error: "A valid project request is required." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const user = await getCurrentUser();
    const handoffId = cookieStore.get(ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME)?.value.trim() || undefined;
    let draft;
    try {
      // The browser-visible draft id is only a display/idempotency value. The
      // HttpOnly handoff cookie is the only route-authorized reference.
      draft = await saveAnonymousIdeaDraft(projectRequest, handoffId);
    } catch (error) {
      // An expired handoff must start a fresh draft rather than resurrecting
      // the old record under the same id.
      if (!(error instanceof RepositoryError) || error.code !== "not-found" || !handoffId) throw error;
      clearAnonymousDraftHandoffCookie(cookieStore);
      draft = await saveAnonymousIdeaDraft(projectRequest);
    }
    if (draft.attachedUserId && !user) {
      clearAnonymousDraftHandoffCookie(cookieStore);
      return NextResponse.json({ error: "The anonymous draft is no longer available." }, { status: 404 });
    }
    const project = user ? await attachAnonymousDraftToUser(draft.id, user.id) : null;
    if (user) clearAnonymousDraftHandoffCookie(cookieStore);
    else setAnonymousDraftHandoffCookie(cookieStore, draft.id);
    return NextResponse.json({ draft: toPublicAnonymousDraft(draft), project: project?.workspace ?? null }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError) {
      const status = error.code === "draft-attached" ? 409 : error.code === "not-found" ? 404 : error.code === "invalid-input" ? 400 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "The anonymous draft could not be saved safely." }, { status: 400 });
  }
}
