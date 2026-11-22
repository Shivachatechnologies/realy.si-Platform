import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { runSlaChecks } from "./sla-job";
import { handleNewTicket } from "./automation";
import { handleInbound } from "./inbound";

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
    // Email channel: mail to the support address becomes tickets (deduped per provider message id).
    { name: "support.inbound-email", types: ["comms.email.received"], handle: async (event) => void (await handleInbound("email", event)) },
    // WhatsApp channel: messages to the company's WhatsApp Business number become tickets.
    { name: "support.inbound-whatsapp", types: ["integration.whatsapp.message_received"], handle: async (event) => void (await handleInbound("whatsapp", event)) },
  ],
};
