import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/server/repository";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  return NextResponse.json({ user });
}
