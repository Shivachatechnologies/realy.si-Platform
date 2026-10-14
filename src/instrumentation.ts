/** Next.js instrumentation hook: runs once per server process (docs/architecture.md §4). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initObservability } = await import("@/server/core/observability");
  await initObservability("realy-web");
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
