import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
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
    const anonymousDraftId = body.anonymousDraftId ?? body.draftId;
    if (anonymousDraftId !== undefined && (typeof anonymousDraftId !== "string" || anonymousDraftId.trim().length === 0 || anonymousDraftId.length > 200)) {
      return NextResponse.json({ error: "The anonymous draft id is invalid." }, { status: 400 });
    }

    const result = await registerUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName as string | undefined,
      anonymousDraftId: anonymousDraftId as string | undefined,
    });
    setSessionCookie(await cookies(), result.token, result.expiresAt);
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
