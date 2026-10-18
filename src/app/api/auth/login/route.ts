import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME,
  authenticateUserAndCreateSession,
  clearAnonymousDraftHandoffCookie,
  isValidEmail,
  RepositoryError,
  setSessionCookie,
  isRepositoryUnavailable,
} from "@/lib/server/repository";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/server/request";

const MAX_REQUEST_BYTES = 16_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await readJsonBody(request, MAX_REQUEST_BYTES);
    if (!isRecord(body) || typeof body.email !== "string" || typeof body.password !== "string" || !isValidEmail(body.email.trim().toLowerCase()) || body.password.length === 0 || body.password.length > 128) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
    }
    const cookieStore = await cookies();
    const anonymousDraftId = cookieStore.get(ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME)?.value.trim() || undefined;
    const result = await authenticateUserAndCreateSession({
      email: body.email,
      password: body.password,
      ...(anonymousDraftId ? { anonymousDraftId } : {}),
    });
    // The repository operation attaches the draft before creating this token.
    // Only publish the session cookie after both durable writes succeeded.
    setSessionCookie(cookieStore, result.token, result.expiresAt);
    if (anonymousDraftId) clearAnonymousDraftHandoffCookie(cookieStore);
    return NextResponse.json({ user: result.user, project: result.project?.workspace ?? null });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError) {
      if (error.code === "invalid-credentials") {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
      const status = error.code === "draft-attached" ? 409 : error.code === "not-found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "The login request could not be processed safely." }, { status: 400 });
  }
}
