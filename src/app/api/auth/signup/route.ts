import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME,
  clearAnonymousDraftHandoffCookie,
  isValidEmail,
  registerUser,
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
    if (!isRecord(body) || typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (!isValidEmail(body.email.trim().toLowerCase()) || body.password.length < 8 || body.password.length > 128) {
      return NextResponse.json({ error: "Use a valid email and a password between 8 and 128 characters." }, { status: 400 });
    }
    if (body.displayName !== undefined && (typeof body.displayName !== "string" || body.displayName.trim().length > 120)) {
      return NextResponse.json({ error: "Display name must be 120 characters or fewer." }, { status: 400 });
    }
    const cookieStore = await cookies();
    const anonymousDraftId = cookieStore.get(ANONYMOUS_DRAFT_HANDOFF_COOKIE_NAME)?.value.trim() || undefined;

    const result = await registerUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName as string | undefined,
      ...(anonymousDraftId ? { anonymousDraftId } : {}),
    });
    setSessionCookie(cookieStore, result.token, result.expiresAt);
    if (anonymousDraftId) clearAnonymousDraftHandoffCookie(cookieStore);
    return NextResponse.json(
      { user: result.user, project: result.project?.workspace ?? null },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof RepositoryError) {
      const status = error.code === "duplicate-user" ? 409 : error.code === "draft-attached" ? 409 : error.code === "not-found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "The account could not be created safely." }, { status: 400 });
  }
}
