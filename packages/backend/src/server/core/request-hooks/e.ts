import type { ProcessApp } from "../observability";

/**
 * Stream E hooks: error grouping (modules/admin/errors.ts) from API 5xx and failed worker jobs, and the warn+ app log
 * store (modules/admin/logs.ts). Modules load on first use so installing costs nothing on cold start.
 */
export async function installE(app: ProcessApp): Promise<void> {
  const { installAppLogSink } = await import("@/server/modules/admin/logs");
  installAppLogSink(app);
  if (app === "worker") {
    const { onJobFailure } = await import("../jobs");
    onJobFailure(async (e) => {
      // Retries are expected; group only final failures (FAILED or dead-lettered).
      if (!e.final) return;
      const { recordError } = await import("@/server/modules/admin/errors");
      await recordError({
        source: "worker",
        error: e.error ?? new Error(e.message),
        route: `${e.queue}/${e.jobName.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}`,
        organizationId: e.organizationId,
        meta: { queue: e.queue, job: e.jobName, attempt: e.attempt, maxAttempts: e.maxAttempts, deadLettered: e.deadLettered },
      });
    });
    return;
  }
  const { onError } = await import("../http");
  onError(async (e) => {
    const { recordError } = await import("@/server/modules/admin/errors");
    await recordError({ source: app, error: e.error, route: e.route, method: e.method, statusCode: e.status, requestId: e.requestId, organizationId: e.organizationId, meta: { kind: e.kind, actorType: e.actorType } });
  });
}
