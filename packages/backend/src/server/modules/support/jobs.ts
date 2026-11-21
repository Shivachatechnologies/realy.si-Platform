import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { runSlaChecks } from "./sla-job";
import { handleNewTicket } from "./automation";

/** Background work of the support module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const SUPPORT_JOBS: ModuleJobs = {
  periodic: [{ name: "support.sla-breach-detection", everyMs: 60_000, run: runSlaChecks }],
  onEvent: [
    {
      // AI first response (and triage) by the hired support AI employee; deduped per ticket.
      name: "support.ai-first-response",
      types: ["ticket.created"],
      async handle(event) {
        const id = (event.payload as { entityId?: string } | null)?.entityId ?? event.aggregateId;
        if (!event.companyId || !id) return;
        await handleNewTicket(event.companyId, id).catch((err) => logger.warn({ err, eventId: event.id }, "support AI first response failed"));
      },
    },
  ],
};
