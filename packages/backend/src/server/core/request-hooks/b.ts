import type { ProcessApp } from "../observability";

/**
 * Stream B hooks (impersonation, modules/admin/impersonation.ts; registered here by stream E at the integrator's
 * request). The gate refuses mutating requests from READ_ONLY impersonation sessions; reads and requests without a
 * session skip it without any lookup. Completion records per-request attribution of impersonated sessions.
 */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function installB(app: ProcessApp): Promise<void> {
  if (app === "worker") return;
  const { onRequestComplete, onRequestGate } = await import("../http");
  const { impersonationRequestGate, recordImpersonatedRequest } = await import("@/server/modules/admin/impersonation");
  onRequestGate(async (e) => {
    if (!e.sessionId || !MUTATING.has(e.method)) return;
    await impersonationRequestGate({ sessionId: e.sessionId, method: e.method, pathname: e.pathname });
  });
  onRequestComplete(async (e) => {
    if (!e.sessionId) return;
    await recordImpersonatedRequest({ sessionId: e.sessionId, requestId: e.requestId, method: e.method, pathname: e.path, route: e.route, status: e.status, durationMs: e.durationMs, at: e.startedAt });
  });
}
