import { NextResponse } from "next/server";

import { searchWithBrave } from "@/lib/research/brave";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const query =
      typeof body === "object" && body !== null && "query" in body && typeof body.query === "string"
        ? body.query.trim()
        : "";

    if (query.length < 3 || query.length > 300) {
      return NextResponse.json({ error: "Research queries must be between 3 and 300 characters." }, { status: 400 });
    }

    const response = await searchWithBrave(query);
    return NextResponse.json(response, { status: response.status === "error" ? 502 : response.status === "unavailable" ? 503 : 200 });
  } catch {
    return NextResponse.json({ error: "The research request could not be processed safely." }, { status: 400 });
  }
}
