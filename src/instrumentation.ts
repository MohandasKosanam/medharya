let startupDiagnosticsRegistered = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;
  if (startupDiagnosticsRegistered) return;
  startupDiagnosticsRegistered = true;

  try {
    const { getProviderStartupDiagnostics } = await import("./lib/providers/startup");
    console.info("[medharya] provider startup diagnostics", JSON.stringify(getProviderStartupDiagnostics(process.env)));
  } catch {
    // Never let configuration or import errors expose raw values through Next's
    // startup error logging, or prevent the server from accepting requests.
    console.info("[medharya] provider startup diagnostics", JSON.stringify({
      provider: "unknown",
      state: "unavailable",
      reason: "diagnostics-unavailable",
      identityVerified: false,
      inferenceVerified: false,
    }));
  }
}
