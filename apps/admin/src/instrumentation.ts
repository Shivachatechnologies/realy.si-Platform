/** Next.js instrumentation hook: runs once per server process (docs/architecture.md §4). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Platform keys set in the Control Center (docs/platform-keys.md) are overlaid onto process.env first, so
  // observability and every env() reader see them. Never throws; falls back to the host env.
  // Not awaited: Next.js holds the first request of a cold instance until register() resolves, and this needs the
  // database (Prisma init + connection + query), which /api/health and public pages do not. Request paths that read
  // platform keys await the same single-flight load themselves (route(), getSession()). Observability starts as soon
  // as the keys are in.
  void (async () => {
    const { ensurePlatformSecretsFresh } = await import("@/server/core/platform-secrets");
    await ensurePlatformSecretsFresh();
    const { initObservability } = await import("@/server/core/observability");
    await initObservability("realy-admin");
  })().catch(() => {});
}

/** Server errors from rendering, route handlers and the proxy. Only path/route metadata is attached — never headers or bodies. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@/server/core/telemetry");
  captureException(error, { method: request.method, route: context.routePath, routeType: context.routeType });
}
