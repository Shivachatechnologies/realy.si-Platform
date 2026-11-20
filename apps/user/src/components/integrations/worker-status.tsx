import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import type { WorkerHealth } from "@/server/core/job-admin";

/**
 * Background execution status for integration pages: scheduled syncs, webhook retries and connection health checks run
 * on the worker service. Renders nothing while a worker is alive; otherwise says plainly what does not run.
 */
export async function WorkerStatusNotice({ state }: { state: WorkerHealth["state"] }) {
  if (state === "ok") return null;
  const t = await getT();
  return (
    <Notice tone={state === "not_configured" ? "info" : "warning"} title={t(`integrations.worker.${state}.title`)}>
      {t(`integrations.worker.${state}.body`)}
    </Notice>
  );
}
