import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clearSessionCookie,
  revokeSessionToken,
  SESSION_COOKIE_NAME,
  isRepositoryUnavailable,
} from "@/lib/server/repository";

export async function POST() {
  const cookieStore = await cookies();
  try {
    await revokeSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    clearSessionCookie(cookieStore);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "The logout request could not be processed safely." }, { status: 503 });
  }
}
