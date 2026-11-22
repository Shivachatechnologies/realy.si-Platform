import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createIncident, createIncidentInput, listIncidents } from "@/server/modules/admin/incidents";

/** GET: incidents (filters: status, state, severity, service, q, cursor). POST: open an incident (platform.incidents.manage). */
export const GET = route({ auth: "required", name: "GET /admin/incidents" }, async ({ req, ctx }) => listIncidents(ctx, Object.fromEntries(req.nextUrl.searchParams)));

export const POST = route({ auth: "required", name: "POST /admin/incidents", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => {
  const input = await body(req, createIncidentInput);
  const incident = await createIncident(ctx, input);
  return { id: incident.id, number: incident.number };
});
