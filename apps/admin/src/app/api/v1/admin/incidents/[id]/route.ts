import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getIncident, updateIncident, updateIncidentInput } from "@/server/modules/admin/incidents";

export const GET = route<{ id: string }>({ auth: "required", name: "GET /admin/incidents/:id" }, async ({ ctx }, { id }) => getIncident(ctx, id));

/** Edit owner, severity, services, affected customers, root cause, mitigation, resolution (audited with a reason). */
export const PATCH = route<{ id: string }>({ auth: "required", name: "PATCH /admin/incidents/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { id }) =>
  updateIncident(ctx, id, await body(req, updateIncidentInput)),
);
