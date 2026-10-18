import { NextResponse } from "next/server";

import { getCurrentUser, isRepositoryUnavailable } from "@/lib/server/repository";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    return NextResponse.json({ user });
  } catch (error) {
    if (isRepositoryUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: "The authentication status could not be read safely." }, { status: 503 });
  }
}
