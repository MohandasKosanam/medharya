import { NextResponse } from "next/server";

import {
  getRepositoryBackend,
  isRepositoryUnavailable,
  readServerDatabase,
} from "@/lib/server/repository";

const noStore = {
  headers: { "Cache-Control": "no-store" },
};

/**
 * Deployment-safe storage readiness check. It reports only the selected
 * backend and readiness state; it never returns credentials, rows, or errors
 * from the database driver.
 */
export async function GET() {
  const backend = getRepositoryBackend();
  if (backend !== "postgres") {
    return NextResponse.json({ status: "unavailable", backend }, { status: 503, ...noStore });
  }

  try {
    await readServerDatabase();
    return NextResponse.json({ status: "ok", backend }, noStore);
  } catch (error) {
    return NextResponse.json(
      {
        status: "unavailable",
        backend,
        reason: isRepositoryUnavailable(error) ? "repository-unavailable" : "storage-check-failed",
      },
      { status: 503, ...noStore },
    );
  }
}
