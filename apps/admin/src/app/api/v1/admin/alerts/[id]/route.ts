import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { alertAction, alertActionInput, getAlert } from "@/server/modules/admin/alerts";

export const GET = route<{ id: string }>({ auth: "required", name: "GET /admin/alerts/:id" }, async ({ ctx }, { id }) => getAlert(ctx, id));

/** Ack, assign, snooze, resolve, reopen, escalate, note, link or open an incident (platform.alerts.manage, reason). */
export const POST = route<{ id: string }>({ auth: "required", name: "POST /admin/alerts/:id", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { id }) =>
  alertAction(ctx, id, await body(req, alertActionInput)),
);
