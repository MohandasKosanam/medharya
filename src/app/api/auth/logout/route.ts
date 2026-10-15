import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clearSessionCookie,
  revokeSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/server/repository";

export async function POST() {
  const cookieStore = await cookies();
  await revokeSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  clearSessionCookie(cookieStore);
  return NextResponse.json({ ok: true });
}
