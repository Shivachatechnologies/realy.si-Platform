import type { ProcessApp } from "../observability";

/**
 * Stream F hooks: the sampled API request logger (modules/admin/api-logs.ts) on request completion. Web apps only;
 * the worker serves no HTTP requests. Retention runs daily in the worker (`admin.api_logs_retention`, worker/ops-jobs.ts).
 */
export async function installF(app: ProcessApp): Promise<void> {
  if (app !== "user" && app !== "admin") return;
  const { onRequestComplete } = await import("../http");
  const { recordApiRequest } = await import("@/server/modules/admin/api-logs");
  onRequestComplete((e) => {
    recordApiRequest({
      app,
      method: e.method,
      route: e.route,
      status: e.status,
      durationMs: e.durationMs,
      requestId: e.requestId,
      organizationId: e.organizationId,
      ip: e.ip,
      userAgent: e.userAgent,
      errorCode: e.errorCode,
    });
  });
}
