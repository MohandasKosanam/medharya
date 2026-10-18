import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  authenticateUser,
  attachAnonymousDraftToUser,
  createSession,
  isValidEmail,
  RepositoryError,
  setSessionCookie,
  toPublicUser,
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
    const anonymousDraftId = body.anonymousDraftId ?? body.draftId;
    if (anonymousDraftId !== undefined && (typeof anonymousDraftId !== "string" || anonymousDraftId.trim().length === 0 || anonymousDraftId.length > 200)) {
      return NextResponse.json({ error: "The anonymous draft id is invalid." }, { status: 400 });
    }

    const user = await authenticateUser({ email: body.email, password: body.password });
    const session = await createSession(user.id);
    setSessionCookie(await cookies(), session.token, session.expiresAt);
    const project = typeof anonymousDraftId === "string"
      ? await attachAnonymousDraftToUser(anonymousDraftId, user.id)
      : null;
    return NextResponse.json({ user: toPublicUser(user), project: project?.workspace ?? null });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError && error.code === "invalid-credentials") {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    return NextResponse.json({ error: "The login request could not be processed safely." }, { status: 400 });
  }
}
